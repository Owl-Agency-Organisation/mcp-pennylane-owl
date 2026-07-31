# MCP Server Pennylane - Owl Agency

Serveur MCP pour connecter Dust à Pennylane (API v2 external).

## Déploiement Vercel

1. Importer ce repo sur Vercel
2. Variables d'environnement :
   - `PENNYLANE_API_TOKEN` — token API Pennylane
   - `PENNYLANE_API_BASE_URL` — optionnel, défaut `https://app.pennylane.com/api/external/v2`
   - `MCP_AUTH_TOKEN` — **obligatoire**, secret partagé qui protège l'endpoint
3. Déployer

> ⚠️ Sans `MCP_AUTH_TOKEN`, le serveur refuse toutes les requêtes (401). C'est
> volontaire : l'endpoint expose l'intégralité de la comptabilité, il ne doit
> jamais être joignable sans authentification. Générer un secret aléatoire long,
> par exemple `openssl rand -hex 32`.

## URL MCP

```
https://[projet].vercel.app/api/mcp
```

## Authentification

Chaque requête doit porter le secret, au choix :

```
Authorization: Bearer $MCP_AUTH_TOKEN
X-MCP-Token: $MCP_AUTH_TOKEN
```

Le `GET` sur l'endpoint sans token renvoie un ping minimal (`{name, status}`).
Avec le token, il renvoie la version, le nombre de tools et leur liste.

## Tests

```bash
npm test
```

36 tests sur le runner intégré de Node (`node --test`, aucune dépendance
ajoutée). Ils exercent le handler directement, avec `fetch` mocké : aucun appel
réel à Pennylane, aucun token nécessaire.

Couverture : authentification (dont le fail-closed), négociation du protocole
MCP, catalogue de tools et cohérence des `inputSchema`, normalisation des
réponses de l'API, plafonnement de la pagination, remontée des erreurs, et
format des requêtes sortantes.

Les fichiers vivent dans `test/` et suivent la convention `*.test.js`.

## Tools (21)

**Monitoring**
- `pennylane_health_check` — statut global : connexion API, exercices, dernières transactions

**Factures clients**
- `pennylane_list_customer_invoices` — lister, filtres par date
- `pennylane_analyze_customer_invoices` — CA, impayés, moyenne sur une période
- `pennylane_get_customer_invoice` — détail d'une facture
- `pennylane_get_customer_invoice_matched_transactions` — transactions rapprochées

**Factures fournisseurs**
- `pennylane_list_supplier_invoices` — lister, filtres par date
- `pennylane_analyze_supplier_invoices` — charges, impayés, moyenne sur une période
- `pennylane_get_supplier_invoice` — détail d'une facture

**Trésorerie**
- `pennylane_list_transactions` — transactions bancaires
- `pennylane_list_bank_accounts` — comptes bancaires, soldes, statuts de connexion

**Contacts**
- `pennylane_get_customers` — clients
- `pennylane_get_suppliers` — fournisseurs

**Comptabilité**
- `pennylane_list_categories` — catégories analytiques
- `pennylane_list_ledger_entries` — écritures comptables
- `pennylane_list_products` — catalogue produits/services
- `pennylane_list_journals` — journaux (ventes, achats, banque, OD)
- `pennylane_list_ledger_accounts` — plan comptable (classes 1 à 7)

**Commercial**
- `pennylane_list_quotes` — devis

**Contexte & exports**
- `pennylane_get_user_context` — profil, entreprise, exercices fiscaux
- `pennylane_list_fiscal_years` — exercices fiscaux
- `pennylane_export_fec` — export FEC sur une période

Tous les tools sont en lecture seule. `pennylane_export_fec` est le seul à faire
un `POST` sur l'API Pennylane (génération d'un export téléchargeable).

La pagination est plafonnée à 100 éléments par appel (limite de l'API).
