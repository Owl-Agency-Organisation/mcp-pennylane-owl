# Serveur MCP Pennylane

Expose la comptabilité [Pennylane](https://www.pennylane.com) à un assistant IA
via le [Model Context Protocol](https://modelcontextprotocol.io). 21 tools en
lecture seule : factures clients et fournisseurs, trésorerie, écritures, plan
comptable, devis, export FEC.

Déployable sur Vercel en quelques minutes. Aucune dépendance en dehors de
Next.js et React.

- [Compatibilité](#compatibilité)
- [Prérequis](#prérequis)
- [Déploiement](#déploiement)
- [Connexion d'un client MCP](#connexion-dun-client-mcp)
- [Les 21 tools](#les-21-tools)
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
3. **Node.js 20+** si vous voulez lancer les tests ou le serveur en local.

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

Cochez les environnements voulus : **Production**, et **Preview** si vous
souhaitez que les déploiements de preview restent utilisables.

> ⚠️ Sans `MCP_AUTH_TOKEN`, le serveur répond `401` à toutes les requêtes. Ce
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

## Les 21 tools

Tous les tools sont en **lecture seule**. `pennylane_export_fec` est le seul à
émettre un `POST` vers l'API Pennylane, pour générer un export téléchargeable.

La pagination est plafonnée à 100 éléments par appel (limite de l'API) : un
`limit` supérieur est ramené à 100, une valeur invalide retombe sur 50.

### Monitoring

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_health_check` | — | Statut global : connexion, exercices, dernières transactions |

### Factures clients

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_list_customer_invoices` | `start_date`, `end_date`, `limit` | Lister les factures clients |
| `pennylane_analyze_customer_invoices` | `start_date`\*, `end_date`\* | CA, impayés, montant moyen sur la période |
| `pennylane_get_customer_invoice` | `invoice_id`\* | Détail d'une facture |
| `pennylane_get_customer_invoice_matched_transactions` | `invoice_id`\* | Transactions bancaires rapprochées |

### Factures fournisseurs

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_list_supplier_invoices` | `start_date`, `end_date`, `limit` | Lister les factures fournisseurs |
| `pennylane_analyze_supplier_invoices` | `start_date`\*, `end_date`\* | Charges, impayés, montant moyen |
| `pennylane_get_supplier_invoice` | `invoice_id`\* | Détail d'une facture |

### Trésorerie

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_list_transactions` | `start_date`, `end_date`, `limit` | Transactions bancaires |
| `pennylane_list_bank_accounts` | `limit` | Comptes bancaires, soldes, statuts de connexion |

### Contacts

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_get_customers` | `limit` | Clients |
| `pennylane_get_suppliers` | `limit` | Fournisseurs |

### Comptabilité

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_list_categories` | `limit` | Catégories analytiques |
| `pennylane_list_ledger_entries` | `start_date`, `end_date`, `limit` | Écritures comptables |
| `pennylane_list_products` | `limit` | Catalogue produits et services |
| `pennylane_list_journals` | `limit` | Journaux (ventes, achats, banque, OD) |
| `pennylane_list_ledger_accounts` | `limit` | Plan comptable, classes 1 à 7 |

### Commercial

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_list_quotes` | `start_date`, `end_date`, `limit` | Devis |

### Contexte et exports

| Tool | Paramètres | Description |
| :--- | :--- | :--- |
| `pennylane_get_user_context` | — | Profil, entreprise, exercices fiscaux |
| `pennylane_list_fiscal_years` | `limit` | Exercices fiscaux |
| `pennylane_export_fec` | `start_date`\*, `end_date`\* | Export FEC (contrôle fiscal français) |

\* paramètre obligatoire. Les dates sont au format `YYYY-MM-DD`.

## Sécurité

**Ce que le serveur protège.** L'endpoint exige le secret partagé sur toute
requête `POST` ainsi que sur le détail du `GET`. La comparaison se fait en temps
constant. Sans `MCP_AUTH_TOKEN` configuré, le serveur refuse tout plutôt que de
s'ouvrir : *fail-closed*.

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

36 tests sur le runner intégré de Node (`node --test`) — aucune dépendance de
test, aucun fichier de configuration. Ils appellent les handlers directement
avec `fetch` mocké : **aucun appel réel à Pennylane, aucun token nécessaire**.

Couverture : authentification (dont le *fail-closed*), négociation du protocole,
catalogue de tools et cohérence des schémas, normalisation des réponses de
l'API, bornes de pagination, remontée des erreurs, format des requêtes
sortantes.

Les tests vivent dans `test/` et suivent la convention `*.test.js`. La CI
GitHub Actions les exécute sur chaque pull request, avec le build.

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

L'endpoint appelé n'existe pas sur la version d'API configurée. Vérifiez
`PENNYLANE_API_BASE_URL` — la valeur par défaut inclut le segment `/external`,
souvent oublié.

### Un tool renvoie `count: 0` sans erreur

Le serveur normalise les réponses de l'API, qui arrivent tantôt en tableau brut,
tantôt en objet paginé. Une forme inconnue produit une liste vide plutôt qu'une
exception. Si vous attendiez des données, vérifiez d'abord les filtres de date,
puis la réponse brute de l'API sur le même endpoint.

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
