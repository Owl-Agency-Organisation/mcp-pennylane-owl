// Outils de niveau 1 : declaration statique. Les schemas d'entree sont
// construits depuis le registre (lib/tools/level1.js). Cette liste ne depend
// pas du registre : scripts/generate-registry.mjs la lit pour verifier que
// chaque operation utilisee existe dans la spec.
//
// kind :
// - get    : une operation, parametres de chemin, reponse relayee telle quelle ;
// - list   : enveloppe de pagination, response_format ;
// - write  : corps valide contre le registre avant l'appel ;
// - custom : traitement dedie (lib/tools/level1.js).

const FISCAL_HINT = ' Pour raisonner par exercice fiscal, appeler d\'abord pennylane_resolve_fiscal_period : les filtres raisonnent en dates calendaires.';

const EXPORT_NOTE = ' Le fichier est destiné à un humain, pas au modèle : pour analyser, utiliser pennylane_get_trial_balance ou pennylane_list_ledger_entry_lines.';

const CHANGELOG_NOTE = ' Renvoie seulement l\'identifiant, l\'opération (insert, update, delete) et les horodatages : ni compte, ni montant, ni valeur antérieure. Relire l\'élément pour connaître son état actuel, ce qui est impossible s\'il a été supprimé. Historique conservé 4 semaines ; start_date (RFC 3339) ne se combine pas avec cursor.';

export const LEVEL1_SPECS = [
  // Contexte et diagnostic
  {
    name: 'pennylane_health_check',
    kind: 'custom',
    method: 'GET',
    operations: ['getMe', 'company-fiscal-years', 'getTransactions'],
    description: 'Vérifier la connexion à Pennylane : utilisateur, société, scopes du token, exercice courant et dernières transactions. À appeler en premier pour diagnostiquer un problème.',
  },
  {
    name: 'pennylane_get_user_context',
    kind: 'get',
    operation: 'getMe',
    description: 'Utilisateur, société (reg_no, référentiel comptable) et scopes du token. Les scopes expliquent un refus 403.',
  },
  {
    name: 'pennylane_resolve_fiscal_period',
    kind: 'custom',
    method: 'GET',
    operations: ['company-fiscal-years'],
    description: 'Interpréter un exercice fiscal : "current" (celui qui contient la date du jour, à Paris) ou un identifiant d\'exercice. Renvoie ses bornes, à reprendre en start_date et end_date dans les outils de liste, et contains_today. Un exercice ne coïncide pas forcément avec l\'année civile.',
  },

  // Socle comptable
  {
    name: 'pennylane_get_trial_balance',
    kind: 'list',
    operation: 'getTrialBalance',
    derive: 'lineBalance',
    description: 'Balance générale sur une période : débits, crédits et solde de chaque compte (balance = débits − crédits, calculé en centimes par le serveur). Aucun total n\'est calculé. Source juste des soldes par compte, à préférer à toute agrégation de listes.' + FISCAL_HINT,
  },
  {
    name: 'pennylane_list_ledger_entries',
    kind: 'list',
    operation: 'getLedgerEntries',
    dateFilter: true,
    description: 'Écritures comptables, filtrables par date.' + FISCAL_HINT,
  },
  {
    name: 'pennylane_get_ledger_entry',
    kind: 'get',
    operation: 'getLedgerEntry',
    description: 'Détail d\'une écriture comptable, avec ses lignes.',
  },
  {
    name: 'pennylane_list_ledger_entry_lines',
    kind: 'list',
    operation: 'getLedgerEntryLines',
    dateFilter: true,
    description: 'Lignes d\'écritures, granularité du FEC, filtrables par date.' + FISCAL_HINT,
  },
  {
    name: 'pennylane_list_ledger_accounts',
    kind: 'list',
    operation: 'getLedgerAccounts',
    description: 'Plan comptable : comptes utilisés, classes 1 à 7.',
  },
  {
    name: 'pennylane_list_journals',
    kind: 'list',
    operation: 'getJournals',
    description: 'Journaux comptables : ventes, achats, banque, opérations diverses.',
  },
  {
    name: 'pennylane_list_fiscal_years',
    kind: 'list',
    operation: 'company-fiscal-years',
    description: 'Exercices fiscaux : bornes et statut (open, reopen, closed, frozen). Pour désigner l\'exercice courant, utiliser pennylane_resolve_fiscal_period.',
  },

  // Exports
  {
    name: 'pennylane_export_fec',
    kind: 'write',
    operation: 'exportFec',
    description: 'Lancer la génération d\'un FEC (Fichier des Écritures Comptables) sur une période. Asynchrone : renvoie un id à passer à pennylane_get_fec_export. Scope exports:fec.' + EXPORT_NOTE,
  },
  {
    name: 'pennylane_get_fec_export',
    kind: 'get',
    operation: 'getFecExport',
    description: 'État d\'un export FEC ; file_url, lien temporaire, une fois le statut ready.' + EXPORT_NOTE,
  },
  {
    name: 'pennylane_export_general_ledger',
    kind: 'write',
    operation: 'exportGeneralLedger',
    description: 'Lancer la génération du grand livre (xlsx) sur une période. Asynchrone : renvoie un id à passer à pennylane_get_general_ledger_export.' + EXPORT_NOTE,
  },
  {
    name: 'pennylane_get_general_ledger_export',
    kind: 'get',
    operation: 'getGeneralLedgerExport',
    description: 'État d\'un export de grand livre ; file_url, lien temporaire, une fois le statut ready.' + EXPORT_NOTE,
  },
  {
    name: 'pennylane_export_analytical_general_ledger',
    kind: 'write',
    operation: 'exportAnalyticalGeneralLedger',
    description: 'Lancer la génération du grand livre analytique (xlsx) sur une période, en lignes (in_line, défaut) ou en colonnes. Asynchrone : renvoie un id à passer à pennylane_get_analytical_general_ledger_export.' + EXPORT_NOTE,
  },
  {
    name: 'pennylane_get_analytical_general_ledger_export',
    kind: 'get',
    operation: 'getAnalyticalGeneralLedgerExport',
    description: 'État d\'un export de grand livre analytique ; file_url, lien temporaire, une fois le statut ready.' + EXPORT_NOTE,
  },

  // Historique des modifications
  {
    name: 'pennylane_list_changelog_ledger_entry_lines',
    kind: 'list',
    operation: 'getLedgerEntryLineChanges',
    firstPageOnly: ['start_date'],
    description: 'Historique des modifications des lignes d\'écritures, du plus ancien au plus récent.' + CHANGELOG_NOTE,
  },
  {
    name: 'pennylane_list_changelog_transactions',
    kind: 'list',
    operation: 'getTransactionChanges',
    firstPageOnly: ['start_date'],
    description: 'Historique des modifications des transactions bancaires, du plus ancien au plus récent.' + CHANGELOG_NOTE,
  },
  {
    name: 'pennylane_list_changelog_supplier_invoices',
    kind: 'list',
    operation: 'getSupplierInvoicesChanges',
    firstPageOnly: ['start_date'],
    description: 'Historique des modifications des factures fournisseurs, du plus ancien au plus récent.' + CHANGELOG_NOTE,
  },

  // Banque
  {
    name: 'pennylane_list_transactions',
    kind: 'list',
    operation: 'getTransactions',
    dateFilter: true,
    description: 'Transactions bancaires, filtrables par date. La transaction fait foi pour établir un flux réel.' + FISCAL_HINT,
  },
  {
    name: 'pennylane_get_transaction',
    kind: 'get',
    operation: 'getTransaction',
    description: 'Détail d\'une transaction bancaire.',
  },
  {
    name: 'pennylane_get_transaction_matched_invoices',
    kind: 'list',
    operation: 'getTransactionMatchedInvoices',
    description: 'Factures rapprochées d\'une transaction : à quoi correspond ce mouvement.',
  },
  {
    name: 'pennylane_list_bank_accounts',
    kind: 'list',
    operation: 'getBankAccounts',
    description: 'Comptes bancaires, soldes et statuts de connexion.',
  },

  // Achats
  {
    name: 'pennylane_list_supplier_invoices',
    kind: 'list',
    operation: 'getSupplierInvoices',
    dateFilter: true,
    description: 'Factures fournisseurs, filtrables par date.' + FISCAL_HINT,
  },
  {
    name: 'pennylane_get_supplier_invoice',
    kind: 'get',
    operation: 'getSupplierInvoice',
    description: 'Détail d\'une facture fournisseur. Porte son fichier (filename, public_file_url) : pas d\'outil dédié aux pièces jointes.',
  },
  {
    name: 'pennylane_get_supplier_invoice_matched_transactions',
    kind: 'list',
    operation: 'getSupplierInvoiceMatchedTransactions',
    description: 'Transactions bancaires rapprochées d\'une facture fournisseur : paiement effectif.',
  },
  {
    name: 'pennylane_list_suppliers',
    kind: 'list',
    operation: 'getSuppliers',
    description: 'Fournisseurs.',
  },

  // Ventes
  {
    name: 'pennylane_list_customer_invoices',
    kind: 'list',
    operation: 'getCustomerInvoices',
    dateFilter: true,
    description: 'Factures clients et avoirs, filtrables par date.' + FISCAL_HINT,
  },
  {
    name: 'pennylane_get_customer_invoice',
    kind: 'get',
    operation: 'getCustomerInvoice',
    description: 'Détail d\'une facture client. Porte son statut e-facture (e_invoicing).',
  },
  {
    name: 'pennylane_get_customer_invoice_matched_transactions',
    kind: 'list',
    operation: 'getCustomerInvoiceMatchedTransactions',
    description: 'Transactions bancaires rapprochées d\'une facture client : encaissement effectif.',
  },
  {
    name: 'pennylane_list_customers',
    kind: 'list',
    operation: 'getCustomers',
    description: 'Clients.',
  },

  // Devis
  {
    name: 'pennylane_list_quotes',
    kind: 'list',
    operation: 'listQuotes',
    description: 'Devis.',
  },
  {
    name: 'pennylane_get_quote',
    kind: 'get',
    operation: 'getQuote',
    description: 'Détail d\'un devis.',
  },
  {
    name: 'pennylane_create_quote',
    kind: 'write',
    operation: 'postQuotes',
    description: 'Créer un devis.',
  },
  {
    name: 'pennylane_update_quote',
    kind: 'write',
    operation: 'updateQuote',
    description: 'Modifier un devis.',
  },

  // Facturation electronique
  {
    name: 'pennylane_get_pa_registrations',
    kind: 'list',
    operation: 'getPaRegistrations',
    description: 'Immatriculation auprès de la plateforme agréée (facturation électronique).',
  },

  // Analytique
  {
    name: 'pennylane_list_categories',
    kind: 'list',
    operation: 'getCategories',
    description: 'Catégories analytiques.',
  },
  {
    name: 'pennylane_create_category',
    kind: 'write',
    operation: 'postCategories',
    description: 'Créer une catégorie analytique dans un groupe.',
  },
  {
    name: 'pennylane_update_category',
    kind: 'write',
    operation: 'updateCategory',
    description: 'Modifier une catégorie analytique.',
  },
  {
    name: 'pennylane_list_category_groups',
    kind: 'list',
    operation: 'getCategoryGroups',
    description: 'Groupes de catégories analytiques.',
  },
  {
    name: 'pennylane_create_category_group',
    kind: 'write',
    operation: 'postCategoryGroups',
    description: 'Créer un groupe de catégories analytiques.',
  },
  {
    name: 'pennylane_update_category_group',
    kind: 'write',
    operation: 'putCategoryGroup',
    description: 'Modifier un groupe de catégories analytiques.',
  },
];

// Operations de l'API appelees par le niveau 1.
export const LEVEL1_OPERATION_IDS = [...new Set(LEVEL1_SPECS.flatMap(spec => spec.operations ?? [spec.operation]))];
