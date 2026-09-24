# Serveur MCP Pennylane

Expose la comptabilité [Pennylane](https://www.pennylane.com) à un assistant IA
via le [Model Context Protocol](https://modelcontextprotocol.io) : 42 outils
explicites (balance générale, écritures, factures, trésorerie, exports,
historique des modifications…), construits sur le registre des opérations de
la Company API v2. Les écritures se limitent à une liste blanche : devis,
catégories analytiques, exports.

Les endpoints appelés sont vérifiés contre le schéma OpenAPI officiel de la
Company API v2.

Déployable sur Vercel en quelques minutes. Aucune dépendance en dehors de
Next.js et React.

- [Compatibilité](#compatibilité)
- [Prérequis](#prérequis)
- [Déploiement](#déploiement)
- [Connexion d'un client MCP](#connexion-dun-client-mcp)
- [Les outils](#les-outils)
- [Sécurité](#sécurité)
- [Développement local](#développement-local)
- [Dépannage](#dépannage)

## Compatibilité

Le serveur est **agnostique du modèle et du client** : il ne contient aucun code
spécifique à un assistant particulier. Il implémente le protocole MCP en
JSON-RPC 2.0 sur un unique endpoint HTTP, et répond toujours en
`application/json`.

| Type de client | Fonctionne | Comment |
| :--- | :---: | :--- |
| Claude (web, Desktop, mobile) et ChatGPT | ✅ | Connecteur distant, OAuth 2.1 |
| Clients MCP parlant HTTP (Dust, plateformes d'agents, intégrations maison) | ✅ | URL de l'endpoint + en-tête d'authentification |
| Clients MCP en stdio uniquement (Claude Desktop et assimilés) | ✅ | via un pont HTTP tel que `mcp-remote` |
| Appels directs (`curl`, scripts) | ✅ | POST JSON-RPC sur `/api/mcp` |

Limites connues, sans impact pour la majorité des clients : le serveur
n'implémente ni le streaming SSE ni les identifiants de session
(`Mcp-Session-Id`). Un client qui *exige* une réponse en flux SSE ne fonctionnera
pas ; le protocole autorise explicitement une réponse JSON simple, que les
clients courants acceptent.

Révisions du protocole servies : `2025-06-18`, `2025-03-26`, `2024-11-05`. Le
serveur renvoie celle demandée par le client si elle figure dans cette liste.

## Prérequis

1. **Un compte Pennylane** avec un token d'API. Il se génère depuis les
   paramètres du compte, section API — voir la documentation développeur
   Pennylane pour le chemin exact, qui évolue avec l'interface.
2. **Un compte Vercel** (l'offre gratuite suffit), ou n'importe quel
   hébergeur capable de faire tourner une application Next.js 15.
3. **Node.js 22+** si vous voulez lancer les tests ou le serveur en local. Le
   script de test s'appuie sur les motifs glob de `node --test`, disponibles à
   partir de Node 21.

## Déploiement

### 1. Récupérer le code

Forkez ce dépôt, ou importez-le directement dans Vercel.

### 2. Générer le secret d'authentification

```bash
openssl rand -hex 32
```

Conservez la valeur — elle sera nécessaire des deux côtés (serveur et client).

### 3. Configurer les variables d'environnement

Dans Vercel : *Settings → Environment Variables*.

| Variable | Obligatoire | Rôle |
| :--- | :---: | :--- |
| `PENNYLANE_API_TOKEN` | ✅ | Token d'API Pennylane |
| `MCP_AUTH_TOKEN` | ✅ | Secret protégeant l'endpoint, généré à l'étape 2 |
| `PENNYLANE_API_BASE_URL` | — | Défaut : `https://app.pennylane.com/api/external/v2` |
| `MCP_PUBLIC_URL` | OAuth | URL publique de l'endpoint, par exemple `https://VOTRE-PROJET.vercel.app/api/mcp` |
| `OAUTH_SIGNING_KEY` | OAuth | Clé de signature des jetons, générée par `openssl rand -hex 32` |
| `OAUTH_OWNER_PASSWORD` | OAuth | Mot de passe du propriétaire, 16 caractères au moins |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | OAuth | Base Upstash Redis, injectées par l'intégration du Marketplace Vercel |

OAuth, nécessaire pour Claude et ChatGPT, s'active quand ses cinq variables sont
présentes. Sans elles, seul le secret partagé est accepté.

Cochez les environnements voulus : **Production**, et **Preview** si vous
souhaitez que les déploiements de preview restent utilisables.

> ⚠️ Sans `MCP_AUTH_TOKEN` ni OAuth, le serveur répond `401` à toutes les requêtes. Ce
> comportement est délibéré : l'endpoint donne accès à l'intégralité d'une
> comptabilité, il ne doit jamais être joignable sans authentification.

### 4. Déployer

Une variable ajoutée n'est pas prise en compte par un déploiement déjà
construit : **redéployez** après avoir renseigné les variables.

### 5. Vérifier

```bash
# Sans token : ping minimal, aucune information sensible
curl https://VOTRE-PROJET.vercel.app/api/mcp
# → {"name":"mcp-pennylane-owl","status":"running"}

# Avec token : détail du serveur
curl -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     https://VOTRE-PROJET.vercel.app/api/mcp
# → version, nombre de tools, liste des tools

# Un appel de tool complet
curl -X POST https://VOTRE-PROJET.vercel.app/api/mcp \
     -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
          "params":{"name":"pennylane_health_check"}}'
```

Si le dernier appel renvoie un exercice fiscal et une date de transaction, la
chaîne complète fonctionne.

## Connexion d'un client MCP

L'URL du serveur est `https://VOTRE-PROJET.vercel.app/api/mcp`.

Le secret se transmet au choix par l'un des deux en-têtes suivants — le second
existe pour les clients qui ne permettent pas de personnaliser `Authorization` :

```
Authorization: Bearer VOTRE_MCP_AUTH_TOKEN
X-MCP-Token: VOTRE_MCP_AUTH_TOKEN
```

> Mettez la **valeur littérale** du secret, pas le nom de la variable. Le client
> est un service externe : il n'a aucun accès aux variables d'environnement du
> serveur.

### Claude et ChatGPT (OAuth)

Ces clients n'envoient pas d'en-tête personnalisé : ils se connectent par OAuth
2.1. Ajoutez un connecteur MCP distant avec l'URL de l'endpoint. Le client
découvre seul le serveur d'autorisation (`/.well-known/oauth-protected-resource`)
et ouvre une page de consentement : saisissez le mot de passe du propriétaire
(`OAUTH_OWNER_PASSWORD`) et autorisez.

- Clients acceptés : ceux dont le document d'identification (*Client ID
  Metadata Document*) est hébergé sur `claude.ai` ou `chatgpt.com`, avec une
  redirection HTTPS.
- Jeton d'accès valable 1 heure, renouvelé automatiquement par le client grâce
  à un refresh token valable 90 jours, qui change à chaque usage.
- Les clients capables d'envoyer un en-tête (Claude Code, `curl`, plateformes
  d'agents) continuent d'utiliser le secret partagé.

### Client HTTP (Dust, plateformes d'agents, intégration maison)

Renseignez l'URL de l'endpoint et l'en-tête d'authentification dans la
configuration du serveur MCP distant.

### Client stdio (Claude Desktop et assimilés)

Ces clients ne parlent pas HTTP directement. Passez par un pont :

```json
{
  "mcpServers": {
    "pennylane": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://VOTRE-PROJET.vercel.app/api/mcp",
        "--header", "Authorization: Bearer VOTRE_MCP_AUTH_TOKEN"
      ]
    }
  }
}
```

## Les outils

Les outils de niveau 1 sont des relais fins vers les opérations de l'API,
construits sur le registre : leurs paramètres suivent les noms et les types de
la spec, et sont validés avant tout appel. Un paramètre inconnu ou mal typé
produit une erreur qui cite les paramètres attendus ; aucun appel ne part. La
liste complète, avec les opérations appelées, est dans
[docs/architecture.md](docs/architecture.md#outils-de-niveau-1).

| Famille | Outils (préfixe `pennylane_`) |
| :--- | :--- |
| Contexte | `health_check`, `get_user_context`, `resolve_fiscal_period` |
| Socle comptable | `get_trial_balance`, `list_ledger_entries`, `get_ledger_entry`, `list_ledger_entry_lines`, `list_ledger_accounts`, `list_journals`, `list_fiscal_years` |
| Exports | `export_fec`, `get_fec_export`, `export_general_ledger`, `get_general_ledger_export`, `export_analytical_general_ledger`, `get_analytical_general_ledger_export` |
| Historique des modifications | `list_changelog_ledger_entry_lines`, `list_changelog_transactions`, `list_changelog_supplier_invoices` |
| Banque | `list_transactions`, `get_transaction`, `get_transaction_matched_invoices`, `list_bank_accounts` |
| Achats | `list_supplier_invoices`, `get_supplier_invoice`, `get_supplier_invoice_matched_transactions`, `list_suppliers` |
| Ventes | `list_customer_invoices`, `get_customer_invoice`, `get_customer_invoice_matched_transactions`, `list_customers` |
| Devis | `list_quotes`, `get_quote`, `create_quote`, `update_quote` |
| Facturation électronique | `get_pa_registrations` |
| Analytique | `list_categories`, `create_category`, `update_category`, `list_category_groups`, `create_category_group`, `update_category_group` |

**Écritures.** Seules les écritures de la liste blanche existent : devis et
catégories (création, modification), création d'exports. Aucune écriture sur
les transactions ni sur les écritures comptables.

### Exercices fiscaux

Un exercice ne coïncide pas forcément avec l'année civile, et plusieurs peuvent
être ouverts à la fois : Pennylane crée les exercices à venir à l'avance.
`pennylane_resolve_fiscal_period` (`fiscal_year` : `"current"` ou identifiant)
renvoie les bornes à reprendre en `start_date` et `end_date` dans les outils de
liste. L'exercice courant est celui qui contient la date du jour, à Paris.

### Balance générale

`pennylane_get_trial_balance` renvoie les débits, les crédits et le solde de
chaque compte (`balance` = débits − crédits), calculé en centimes entiers à
partir des montants de l'API, jamais en nombres flottants. Aucun total n'est
calculé.

### Pagination

Les outils de liste renvoient la même enveloppe :

```json
{ "items": [], "count": 50, "has_more": true, "next_cursor": "…", "truncated": false }
```

- `limit` : taille de page, bornée au maximum documenté par l'opération (100
  en général), 50 par défaut.
- `cursor` : la valeur `next_cursor` d'une réponse précédente, pour lire la
  page suivante. Les filtres doivent être renvoyés à l'identique : le curseur
  ne les mémorise pas.
- `fetch_all` : lit aussi les pages suivantes, dans la limite de 10 pages, de
  25 secondes et de 100 000 caractères. Si la liste reste incomplète,
  `truncated` vaut `true`, un `message` l'explique, et `next_cursor` permet de
  reprendre. Le plafond de taille protège la fenêtre de contexte du modèle :
  les écritures d'un exercice complet pèsent plusieurs centaines de milliers
  de caractères. Au-delà, mieux vaut resserrer les filtres, lire la balance
  générale ou passer par l'export FEC.
- `count` est le nombre d'éléments renvoyés, jamais un total de la ressource.
- `response_format` : `markdown` par défaut, une ligne par élément, champs
  vides omis ; `json` pour la réponse complète.

Les appels vers Pennylane sont espacés d'au moins 250 ms : l'API autorise
25 requêtes par fenêtre de 5 secondes et par token. Un `429` est repris après
le délai indiqué par l'en-tête `retry-after`, deux fois au plus.

### Exports : un flux en deux temps

La génération d'un FEC, d'un grand livre ou d'un grand livre analytique est
asynchrone côté Pennylane. L'outil `export_*` crée la demande et renvoie un
`id` au statut `pending` ; l'outil `get_*_export` correspondant renvoie
`file_url`, un lien temporaire, une fois le statut passé à `ready`. Ce fichier
est destiné à un humain : pour analyser, la balance générale et les lignes
d'écritures conviennent au modèle. Le FEC requiert le scope `exports:fec`.

### Scopes

Le token Pennylane porte des scopes qui déterminent les endpoints accessibles.
Sur un refus `403`, le message d'erreur cite les scopes réels du token, lus sur
`/me` : aucun scope manquant n'est deviné. `pennylane_get_user_context` et
`pennylane_health_check` renvoient aussi cette liste.

> **Note de compatibilité** : depuis le 1er juillet 2026, fin du déploiement
> des [changements 2026 de l'API Pennylane](https://pennylane.readme.io/docs/2026-api-changes-guide),
> le paramètre `use_2026_api_changes` et l'en-tête `X-Use-2026-API-Changes`
> n'ont plus d'effet : seul le nouveau comportement existe (pagination par
> curseur sur toutes les listes, scopes granulaires à la place de `ledger`).
> Ce serveur ne les envoie pas.

## Sécurité

**Ce que le serveur protège.** L'endpoint exige le secret partagé ou un jeton
OAuth sur toute requête `POST` ainsi que sur le détail du `GET`. La comparaison
se fait en temps constant. Sans `MCP_AUTH_TOKEN` configuré, le secret partagé
est refusé plutôt que de laisser l'endpoint ouvert : *fail-closed*.

**OAuth.** Le serveur d'autorisation tourne sur la même origine que
l'endpoint :

- PKCE S256 obligatoire, jeton lié à cette ressource (`aud`) ;
- code d'autorisation valable 60 secondes et à usage unique ;
- refresh token renouvelé à chaque usage : s'il est présenté une seconde fois,
  l'autorisation entière est révoquée ;
- codes et refresh tokens stockés uniquement sous forme d'empreinte SHA-256 ;
- après 5 mots de passe erronés depuis une même adresse en 15 minutes, ou 20
  en une heure au total, la page de consentement refuse toute tentative.

**Ce qui est public.** Un `GET` sans token renvoie uniquement
`{"name":"…","status":"running"}` — ni la liste des tools, ni la configuration,
ni la moindre donnée comptable. La page d'accueil du déploiement est publique et
volontairement vide de tout élément sensible.

**Ce qui reste à votre charge.**

- **La force du secret.** Utilisez `openssl rand -hex 32`. Il n'y a aucune
  limitation de débit sur l'endpoint : à 256 bits d'entropie c'est sans
  conséquence, mais un secret court ou devinable serait attaquable par force
  brute.
- **Le token Pennylane ne quitte jamais le serveur.** Il n'est jamais renvoyé
  au client, y compris authentifié.
- **Les deux secrets sont distincts.** Ne réutilisez pas le token Pennylane
  comme `MCP_AUTH_TOKEN` : ils n'ont ni la même portée ni les mêmes porteurs.
- **Rotation.** Nouvelle valeur dans l'hébergeur, redéploiement, puis mise à
  jour côté client. Le serveur n'accepte qu'un secret à la fois : prévoyez une
  courte fenêtre de `401`.
- **Ne committez jamais vos secrets.** `.env` et `.env.local` sont ignorés par
  git ; `.env.example` documente les variables sans valeur.

## Développement local

```bash
npm install
cp .env.example .env.local   # puis renseignez vos valeurs
npm run dev                  # http://localhost:3000
```

### Tests

```bash
npm test
```

180 tests sur le runner intégré de Node (`node --test`) — aucune dépendance de
test, aucun fichier de configuration. Ils appellent les handlers directement
avec `fetch` mocké : **aucun appel réel à Pennylane, aucun token nécessaire**.

Couverture : authentification (dont le *fail-closed*), négociation du protocole,
catalogue de tools et cohérence des schémas, normalisation des réponses de
l'API, pagination par curseur et `fetch_all`, cadence des appels et reprise
après un `429`, remontée des erreurs, format des requêtes sortantes, serveur
d'autorisation OAuth (PKCE, code à usage unique, rotation et détection de
réutilisation des refresh tokens, limitation des essais de mot de passe).

Les tests vivent dans `test/` et suivent la convention `*.test.js`.

**Fixtures d'or.** `test/fixtures/pennylane/` contient des réponses réelles de
l'API (`/me`, `/fiscal_years`, `/trial_balance`, `/journals`), anonymisées par
`scripts/anonymize-fixtures.mjs` : identités, identifiants et montants sont
remplacés, les montants fictifs ne dépendant jamais des montants réels. Les
captures brutes ne sont jamais versionnées. `test/fixtures.test.js` rejoue les
outils contre ces fixtures, à date figée.
 La CI
GitHub Actions les exécute sur chaque pull request, avec le build.

### Registre des opérations

```bash
npm run registry            # régénère lib/registry.json depuis openapi/accounting.json
npm run registry:refresh    # télécharge la spec officielle, puis régénère
```

Le registre décrit les 174 opérations de la Company API v2. Il est vérifié
avant chaque build : un registre désynchronisé de la spec, ou une opération
utilisée par un outil qui disparaîtrait de la spec, fait échouer le build.

### Test smoke

```bash
npm run build
npm run smoke
```

Démarre le serveur de production sur un port libre, avec un secret MCP généré
pour la durée du test, puis vérifie `initialize`, `tools/list` (nombre d'outils
attendu, aucun doublon, poids sous 15 000 tokens) et un
`pennylane_health_check` **contre le vrai Pennylane** : l'exercice courant doit
contenir la date du jour, la liste des scopes doit être non vide. Exige
`PENNYLANE_API_TOKEN`, dans l'environnement ou dans `.env.local`.

La CI l'exécute après le build, avec le secret `PENNYLANE_API_TOKEN` du dépôt.
Une pull request ouverte depuis un fork n'a pas accès à ce secret : elle échoue
à cette étape.

## Dépannage

### `401 Unauthorized`

Trois causes, par ordre de fréquence :

1. **`MCP_AUTH_TOKEN` absent côté serveur.** Vérifiez avec un `GET` authentifié
   sur `/api/mcp` : s'il renvoie le ping minimal alors que vous envoyez le bon
   en-tête, c'est que le serveur n'a pas le secret. Vérifiez aussi que le
   déploiement est postérieur à l'ajout de la variable.
2. **Valeurs différentes entre client et serveur.** Un espace ou un retour à la
   ligne collé en fin de valeur suffit ; la comparaison est stricte.
3. **Nom de variable envoyé au lieu de sa valeur.** L'en-tête doit contenir le
   secret littéral.

### `Pennylane API error 401`

Distinct du précédent : cette erreur arrive *dans* le résultat d'un tool, avec
`isError: true`. Elle signale que c'est le **token Pennylane** qui est invalide
ou expiré, et non le secret MCP.

### `Pennylane API error 404`

L'identifiant demandé n'existe pas, ou l'endpoint n'existe pas sur la version
d'API configurée. Dans le second cas, vérifiez `PENNYLANE_API_BASE_URL` : la
valeur par défaut inclut le segment `/external`, souvent oublié.

### Un outil de liste renvoie `count: 0` sans erreur

Vérifiez d'abord les filtres de date : ils raisonnent en dates calendaires, et
un exercice ne coïncide pas forcément avec l'année civile.
`pennylane_resolve_fiscal_period` donne les bornes exactes d'un exercice.

### Le client ne voit aucun tool

Vérifiez que le client atteint bien `/api/mcp` et non la racine du domaine, et
qu'il transmet l'en-tête d'authentification sur `initialize` comme sur
`tools/list`.

## Contribuer

Les issues et pull requests sont bienvenues. Merci de faire passer `npm test` et
`npm run build` avant de proposer une PR, et d'ajouter un test pour tout
changement de comportement du handler.

## Licence

[MIT](LICENSE) — un projet [Owl Agency](https://owl-agency.io).
