# Architecture

Ce document décrit l'architecture cible du serveur : l'organisation en trois
niveaux, les conventions communes à tous les outils et la liste des outils de
niveau 1 avec leurs endpoints.

Les chemins sont relatifs à la base `https://app.pennylane.com/api/external/v2`.
Ils ont été vérifiés contre la spec OpenAPI officielle de la Company API v2
(`https://pennylane.readme.io/openapi/accounting.json`, 174 opérations au
24/09/2026).

## Trois niveaux

L'API compte environ 170 opérations. Les exposer toutes comme outils à plat
alourdirait chaque `tools/list` au point de saturer le contexte du modèle. Le
serveur les répartit donc en trois niveaux.

| Niveau | Rôle | Outils |
| :--- | :--- | :--- |
| 1 | Outils explicites pour les usages courants | Voir [Outils de niveau 1](#outils-de-niveau-1) |
| 2 | Découverte des autres opérations | `pennylane_search_operations` |
| 3 | Description et exécution de toute opération du registre | `pennylane_describe_operation`, `pennylane_call_operation` |

Budget : la réponse à `tools/list` reste sous **15 000 tokens**. Le test smoke
le vérifie.

### Niveau 1 : outils explicites

Schémas d'entrée typés issus du registre, descriptions rédigées, annotations
complètes. Ce sont des relais fins : ils transmettent l'appel et la réponse sans
calcul. Toute dérivation vit dans une fonction unique, nommée et testée.

### Niveau 2 : découverte

```
pennylane_search_operations(query: string, limit?: number)
  → [{ operation_id, method, path, summary, scopes }]
```

Recherche plein texte dans le registre (résumé, chemin, tags). Ne renvoie pas
les schémas, seulement de quoi choisir. `scopes` reprend ce que documente la
spec, à titre indicatif : aucun contrôle de droits n'en est déduit.

### Niveau 3 : description et exécution

```
pennylane_describe_operation(operation_id: string)
  → { operation_id, method, path, parameters, request_body, response, scopes }

pennylane_call_operation(operation_id: string, path_params?, query?, body?)
```

`pennylane_call_operation` valide les paramètres contre le registre **avant**
tout appel HTTP. Un paramètre inconnu ou mal typé produit une erreur qui cite
les paramètres attendus, et aucun appel ne part.

Les opérations de lecture (`GET`) sont toutes accessibles. Une opération
d'écriture ne l'est que si elle figure dans la liste blanche :

| Domaine | Écritures autorisées |
| :--- | :--- |
| Catégories et groupes de catégories | Création, modification |
| Clients | Création, modification |
| Devis | Création, modification |
| Pièces jointes | Ajout de fichiers (`POST /file_attachments`) et annexes de devis (`POST /quotes/{quote_id}/appendices`) |
| Exports | Création : FEC, grand livre, grand livre analytique |

Les clients n'ont pas d'outil de niveau 1 : leur création et leur
modification passent par le niveau 3. Les annexes de factures clients et de
documents commerciaux restent hors périmètre.

La liste blanche est tenue opération par opération dans
`lib/tools/write-whitelist.js`. Les opérations au rattachement ambigu en sont
exclues jusqu'à décision explicite : changement de statut et envoi par email
d'un devis, contacts et catégories d'un client. L'envoi de fichier
(`multipart/form-data`) est refusé tant que son mécanisme n'est pas arbitré.

Toute autre écriture est refusée avec un message explicite, en particulier sur
les transactions et les écritures comptables. Les abonnements webhook sont
exclus à tous les niveaux tant que le récepteur de webhooks n'existe pas :
aucun outil de niveau 1, ni recherche, ni description, ni appel, lecture
comprise.

## Registre des opérations

`scripts/generate-registry.mjs` lit la spec OpenAPI et produit
`lib/registry.json` : pour chaque opération, `operation_id`, méthode, chemin,
paramètres typés, schéma du corps, schéma de réponse (trois niveaux), résumé et
scopes documentés.

- La spec est committée (`openapi/accounting.json`) : le build ne lit jamais
  le réseau. `npm run registry:refresh` la télécharge et régénère le registre ;
  la mise à jour passe par une PR relisible.
- Le registre est committé, une opération par ligne : le diff d'une PR montre
  exactement lesquelles changent. Le serveur ne fait aucune lecture réseau au
  runtime pour le charger.
- Avant chaque build (`prebuild`), `generate-registry.mjs --check` vérifie que
  le registre correspond à la spec committée et que toutes les opérations du
  niveau 1 (`lib/level1-operations.js`) y figurent. Sinon, le build échoue :
  une rupture d'API casse le build au lieu de casser la production.

## Conventions

### Nommage

`pennylane_{action}_{ressource}`, en snake_case. Le préfixe évite les
collisions avec d'autres serveurs MCP montés en parallèle.

### Pagination

Tout outil de liste renvoie la même enveloppe :

```json
{ "items": [], "count": 50, "has_more": true, "next_cursor": "…", "truncated": false }
```

- `limit` est borné de 1 à 100, 50 par défaut.
- `has_more` et `next_cursor` sont toujours remontés, tels que Pennylane les
  renvoie.
- `fetch_all` (optionnel, `false` par défaut) parcourt les pages suivantes,
  dans la limite d'un nombre maximal de pages, du temps d'exécution d'une
  fonction Vercel et d'une taille de réponse (`FETCH_ALL_MAX_CHARS`,
  100 000 caractères de JSON compact, pour ne pas saturer le contexte du
  modèle). S'il s'arrête avant la fin : `truncated: true` et un message
  explicite. Au-delà du plafond de taille, le message oriente vers des filtres
  plus étroits, `pennylane_get_trial_balance` ou l'export FEC.
- Aucun outil ne renvoie un total calculé à partir d'une page. `count` est le
  nombre d'éléments renvoyés, pas le total de la ressource.

### Débit

L'API limite à 5 requêtes par seconde par token et répond 429 au-delà, avec un
délai de reprise. Tout enchaînement d'appels est cadencé sous cette limite, et
un 429 est géré avec reprise.

### Annotations MCP

Portées par tous les outils, dérivées du verbe HTTP de l'opération :

| Verbe | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| :--- | :--- | :--- | :--- |
| GET | `true` | `false` | `true` |
| POST | `false` | `false` | `false` |
| PUT, PATCH | `false` | `false` | `true` |
| DELETE | `false` | `true` | `true` |

`openWorldHint: true` partout. Ce sont des indications destinées au client, pas
des garanties : la liste blanche d'écriture reste appliquée dans le code.

### Erreurs

Toute erreur est renvoyée dans le résultat de l'outil, avec `isError: true` et
un message qui indique la suite :

- 403 : citer les scopes réels du token, lus sur `/me`. Aucun scope manquant
  n'est prédit.
- 404 sur un chemin : suggérer `pennylane_search_operations`.
- Paramètre invalide : lister les paramètres attendus, lus dans le registre.

Un message d'erreur n'expose jamais de détail interne ni le token.

### Format de réponse

Le résultat d'un outil est sérialisé en JSON compact, sans indentation.

Paramètre `response_format: "json" | "markdown"`, `"markdown"` par défaut sur
les listes : plus compact pour le modèle sur les grandes listes. Le JSON reste
disponible pour un traitement programmatique.

### Version de l'API

Aucun drapeau `use_2026_api_changes` : depuis le 01/07/2026, fin du
déploiement par phases de Pennylane (*preview*, *sunset*, *cleanup*), seul le
comportement 2026 existe. Ni le paramètre ni l'en-tête ne sont envoyés.

### Exercices fiscaux

Un exercice ne coïncide pas forcément avec l'année civile : il peut par
exemple courir du 16/05/2024 au 31/12/2025. Les filtres de l'API, eux,
raisonnent en dates calendaires.

```
pennylane_resolve_fiscal_period(fiscal_year: "current" | id)
```

Cet outil concentre toute l'interprétation d'exercice. Les descriptions des
outils de liste filtrables par date invitent à l'appeler d'abord pour
raisonner par exercice.

Toute dérivation vit dans `lib/derivations.js`, seul point où le serveur
calcule une valeur au lieu de la relayer : date du jour à Paris, exercice
courant, bornes d'exercice, solde d'une ligne de balance en centimes entiers.

## Transport et authentification

Endpoint unique `/api/mcp`, JSON-RPC 2.0 sur HTTP : Streamable HTTP, réponses
JSON, sans état, sans SSE. Deux credentials acceptés :

- **Secret partagé** (`Authorization: Bearer` ou `X-MCP-Token`), pour les
  clients qui envoient un en-tête : Claude Code, scripts, plateformes d'agents.
- **Jeton d'accès OAuth 2.1**, pour Claude et ChatGPT.

### Serveur d'autorisation OAuth

Il tourne sur la même origine que l'endpoint (`lib/oauth/`) et ne s'active
que si sa configuration est complète.

| Élément | Choix |
| :--- | :--- |
| Découverte | `/.well-known/oauth-protected-resource` (aussi sous `/api/mcp`), `/.well-known/oauth-authorization-server` ; le `401` porte `resource_metadata` |
| Points d'entrée | `/oauth/authorize` (consentement), `/oauth/token` (form-urlencoded) |
| Enregistrement des clients | CIMD uniquement, documents hébergés sur `claude.ai` ou `chatgpt.com`, redirections HTTPS uniquement. Pas de DCR |
| Authentification | Mot de passe du propriétaire ; 5 échecs par adresse sur 15 min, 20 au total sur 1 h |
| PKCE et ressource | S256 obligatoire ; `resource` doit désigner cet endpoint, recopié dans `aud` |
| Jeton d'accès | JWT HS256, 1 h, vérifié sans stockage |
| Code d'autorisation | 60 s, usage unique (`GETDEL`) |
| Refresh token | 90 jours, rotation à chaque usage ; la réutilisation d'un jeton déjà échangé révoque toute l'autorisation |
| Stockage | Upstash Redis, appelé en REST : codes, refresh tokens et compteurs d'échecs, par empreinte SHA-256 uniquement |
| Scope | Unique : `pennylane` |

Un jeton d'accès reste valable jusqu'à son expiration, même après révocation de
son autorisation : la vérification sans stockage est à ce prix, borné à une
heure.

## Outils de niveau 1

Statuts : **existant** (présent en v1.4.0), **nouveau**, **renommé**. Tous sont
déclarés dans `lib/tools/level1-specs.js` et construits sur le registre
(`lib/tools/level1.js`) : paramètres de chemin et de requête, corps
d'écriture, tous validés avant l'appel. Les corps d'écriture de plus de
2 000 caractères (devis) ne sont pas dépliés dans `tools/list` : ils passent
par un paramètre `body`, validé contre le registre, dont le schéma complet
s'obtient par `pennylane_describe_operation`.

### Contexte et diagnostic

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_health_check` | `GET /me`, `GET /fiscal_years`, `GET /transactions` | Existant |
| `pennylane_get_user_context` | `GET /me`, relayé tel quel | Existant |
| `pennylane_resolve_fiscal_period` | `GET /fiscal_years` | Nouveau |

### Socle comptable

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_get_trial_balance` | `GET /trial_balance`, solde par ligne dérivé | Nouveau |
| `pennylane_list_ledger_entries` | `GET /ledger_entries` | Existant |
| `pennylane_get_ledger_entry` | `GET /ledger_entries/{id}` | Nouveau |
| `pennylane_list_ledger_entry_lines` | `GET /ledger_entry_lines` | Nouveau |
| `pennylane_list_ledger_accounts` | `GET /ledger_accounts` | Existant |
| `pennylane_list_journals` | `GET /journals` | Existant |
| `pennylane_list_fiscal_years` | `GET /fiscal_years` | Existant |

### Exports

Flux asynchrone en deux temps : la création renvoie un identifiant, la lecture
renvoie l'état et, une fois prêt, un lien de téléchargement. Aucune boucle
d'attente côté serveur : elle dépasserait le temps d'exécution d'une fonction
Vercel.

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_export_fec` | `POST /exports/fecs` | Existant |
| `pennylane_get_fec_export` | `GET /exports/fecs/{id}` | Existant |
| `pennylane_export_general_ledger` | `POST /exports/general_ledgers` | Nouveau |
| `pennylane_get_general_ledger_export` | `GET /exports/general_ledgers/{id}` | Nouveau |
| `pennylane_export_analytical_general_ledger` | `POST /exports/analytical_general_ledgers` | Nouveau |
| `pennylane_get_analytical_general_ledger_export` | `GET /exports/analytical_general_ledgers/{id}` | Nouveau |

### Historique des modifications

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_list_changelog_ledger_entry_lines` | `GET /changelogs/ledger_entry_lines` | Nouveau |
| `pennylane_list_changelog_transactions` | `GET /changelogs/transactions` | Nouveau |
| `pennylane_list_changelog_supplier_invoices` | `GET /changelogs/supplier_invoices` | Nouveau |

Ces outils ne renvoient que l'identifiant, l'opération et les horodatages. L'historique est conservé 4 semaines ; `start_date` (RFC 3339) ne se combine pas avec `cursor`, et n'est envoyé qu'à la première page.

### Banque

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_list_transactions` | `GET /transactions` | Existant |
| `pennylane_get_transaction` | `GET /transactions/{id}` | Nouveau |
| `pennylane_get_transaction_matched_invoices` | `GET /transactions/{transaction_id}/matched_invoices` | Nouveau |
| `pennylane_list_bank_accounts` | `GET /bank_accounts` | Existant |

### Achats

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_list_supplier_invoices` | `GET /supplier_invoices` | Existant |
| `pennylane_get_supplier_invoice` | `GET /supplier_invoices/{id}` | Existant |
| `pennylane_get_supplier_invoice_matched_transactions` | `GET /supplier_invoices/{supplier_invoice_id}/matched_transactions` | Nouveau |
| `pennylane_list_suppliers` | `GET /suppliers` | Renommé (`pennylane_get_suppliers`) |

La description de `pennylane_get_supplier_invoice` précise que la facture
porte son fichier (`filename`, `public_file_url`). Aucun outil dédié à la
lecture des pièces jointes.

### Ventes

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_list_customer_invoices` | `GET /customer_invoices` | Existant |
| `pennylane_get_customer_invoice` | `GET /customer_invoices/{id}` | Existant |
| `pennylane_get_customer_invoice_matched_transactions` | `GET /customer_invoices/{customer_invoice_id}/matched_transactions` | Existant |
| `pennylane_list_customers` | `GET /customers` | Renommé (`pennylane_get_customers`) |

La description de `pennylane_get_customer_invoice` précise que la facture
porte son statut e-facture (`e_invoicing`). Aucun outil dédié.

### Devis

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_list_quotes` | `GET /quotes` | Existant, sans filtre de date |
| `pennylane_get_quote` | `GET /quotes/{id}` | Nouveau |
| `pennylane_create_quote` | `POST /quotes` | Nouveau |
| `pennylane_update_quote` | `PUT /quotes/{id}` | Nouveau |

L'API n'accepte pas de filtre `date` sur les devis (champs admis : `id`,
`customer_id`, `status`) : l'ancien outil, qui en envoyait un, échouait en
400.

### Facturation électronique

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_get_pa_registrations` | `GET /pa_registrations` | Nouveau |

### Analytique

| Outil | Opération | Statut |
| :--- | :--- | :--- |
| `pennylane_list_categories` | `GET /categories` | Existant |
| `pennylane_create_category` | `POST /categories` | Nouveau |
| `pennylane_update_category` | `PUT /categories/{id}` | Nouveau |
| `pennylane_list_category_groups` | `GET /category_groups` | Nouveau |
| `pennylane_create_category_group` | `POST /category_groups` | Nouveau |
| `pennylane_update_category_group` | `PUT /category_groups/{id}` | Nouveau |

### Retirés du catalogue v1.4.0

| Outil | Motif |
| :--- | :--- |
| `pennylane_analyze_customer_invoices` | Calculait un total sur la première page. Remplacé par `pennylane_get_trial_balance` |
| `pennylane_analyze_supplier_invoices` | Même défaut, sur les charges |
| `pennylane_list_products` | Accessible par les niveaux 2 et 3 |

### À arbitrer

- **Ajout de pièces jointes.** L'ajout de fichiers (`POST /file_attachments`)
  et les annexes de devis (`POST /quotes/{quote_id}/appendices`) reçoivent un
  fichier. La manière dont l'outil le reçoit reste à choisir, en tenant compte
  de la limite de taille du corps des requêtes des fonctions Vercel.
