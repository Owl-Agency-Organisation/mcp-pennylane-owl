# CLAUDE.md

Consignes pour les agents qui travaillent sur ce dépôt. Le dépôt est public :
ce fichier ne contient, et ne doit jamais contenir, aucun secret.

## Objectif

Faire évoluer le serveur vers un serveur MCP couvrant l'intégralité de la
Company API v2 de Pennylane, utilisable depuis Claude, ChatGPT et tout client
MCP HTTP. Usage visé : une IA qui joue l'expert-comptable secondaire, prépare
et contrôle, pour une transmission impeccable au comptable humain.

Architecture inchangée : GitHub vers Vercel, Next.js, endpoint unique
`/api/mcp`.

## Références

- **Architecture** : [`docs/architecture.md`](docs/architecture.md) fait
  référence. Les trois niveaux, les conventions communes et la liste des
  outils de niveau 1 avec leurs endpoints.
- **Archives** (hors dépôt) : la spécification initiale
  `spec-mcp-pennylane-owl.md`, les documents de passation du 31/07/2026 et
  leurs addendums 1 et 2. Autorité sur l'historique des décisions et le détail
  des bugs, jamais sur l'état du dépôt.
- En cas de conflit, ce fichier et `docs/architecture.md` priment sur les
  archives.

## Décisions arrêtées

| Sujet | Décision |
| :--- | :--- |
| Écriture | Liste blanche par domaine. **Autorisé** : catégories et groupes de catégories (création, modification), clients (création, modification), devis (création, modification), pièces jointes : ajout de fichiers (`POST /file_attachments`) et annexes de devis (`POST /quotes/{quote_id}/appendices`), création d'exports (FEC, grand livre, grand livre analytique). **Interdit en toutes circonstances** : transactions, écritures comptables, et tout domaine hors de cette liste |
| Webhooks | Exclus à tous les niveaux, y compris de la liste blanche de `pennylane_call_operation`, tant que le récepteur n'existe pas. Le scope reste sur le token : seule la liste blanche les exclut. À rouvrir avec le chantier du récepteur |
| Contrôle de droits | Aucune prédiction de type `access: "missing_scope"` : le schéma a déjà divergé du comportement réel (nommage des scopes jusqu'en juillet 2026), et le token mélange encore `:read` et `:readonly` : la seule source fiable des droits est `/me`. L'appel part, et un 403 est rendu actionnable en citant les scopes réels issus de `/me` |
| OAuth 2.1 | Serveur d'autorisation sur la même origine, en parallèle du secret partagé. Stockage : Upstash Redis via le Marketplace Vercel, appelé en REST, région alignée sur les fonctions ; aucun code ni refresh token en clair, seulement son empreinte SHA-256. Propriétaire authentifié par `OAUTH_OWNER_PASSWORD`, avec limitation des essais. Enregistrement : CIMD seul, hôtes `claude.ai` et `chatgpt.com`. Durées : code 60 s, accès 1 h, refresh 90 jours avec rotation et détection de réutilisation. Scope unique `pennylane`. Claude Code continue d'utiliser le secret partagé en en-tête |
| Outils `analyze_*` | Supprimés : ils calculent des totaux sur la première page. Remplacés par `pennylane_get_trial_balance` |
| Interprétation | Les outils de niveau 1 sont des relais fins. Toute dérivation vit dans un point unique, nommé et testé : 3 bugs sur 4 sont nés dans les deux seuls outils qui dérivaient une valeur |
| Registre | Généré au build depuis la spec OpenAPI, committé, aucune lecture réseau au runtime |
| Pagination | Aucun outil ne renvoie un total calculé sur une page |
| Débit | Voir « Contrainte de débit » |
| `use_2026_api_changes` | Aucun drapeau : depuis le 01/07/2026 (phase *cleanup* du déploiement Pennylane), l'opt-in et l'opt-out sont désactivés et seul le comportement 2026 existe. Ni le paramètre ni l'en-tête `X-Use-2026-API-Changes` ne sont envoyés |

## Contrainte de débit

L'API Pennylane limite à **5 requêtes par seconde par token**. Au-delà, elle
répond HTTP 429 avec un délai de reprise. Tout enchaînement d'appels, en
particulier `fetch_all`, est cadencé sous cette limite et gère le 429 avec
reprise.

## Règles de travail

- `develop` est la branche d'intégration. Une branche et une PR par étape,
  ciblant `develop`, avec son motif. Merge dans `develop` dès que la CI est
  verte.
- `main` n'est modifiée que par Philippe, par PR depuis `develop`. Jamais de
  commit ni de push direct sur `main`.
- Arrêt obligatoire aux points STOP de la mission en cours, et face à toute
  décision d'architecture non couverte par ce fichier : proposer, ne pas
  trancher.
- Aucun mécanisme de repli non demandé. Discipline stricte de périmètre.
- Ce qui relève de Philippe (Vercel, Pennylane, GitHub, claude.ai) est signalé
  explicitement, avec la procédure pas à pas.
- Aucun appel en écriture réel sur Pennylane, hors création d'export. Les
  outils d'écriture sont testés sur `fetch` simulé.
- Les workflows GitHub Actions se déclenchent sur `push` et `pull_request`,
  jamais sur `pull_request_target` : le secret `PENNYLANE_API_TOKEN` ne doit
  jamais être exposé au code d'une PR externe.

## Secrets

- Les secrets vivent dans `.env.local`, ignoré par git, obtenu par
  `vercel env pull .env.local --environment=production`.
- Ne jamais afficher la valeur d'un secret : ni dans la conversation, ni dans
  un fichier versionné, ni dans un log.
- Ne consulter aucune autre source de secrets.
