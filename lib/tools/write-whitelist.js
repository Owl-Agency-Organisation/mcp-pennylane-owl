// Liste blanche des ecritures accessibles par pennylane_call_operation, par
// domaine. Toute operation qui n'est pas une lecture (GET) et n'y figure pas
// est refusee. Interdit en toutes circonstances : transactions, ecritures
// comptables, et tout domaine hors de cette liste.
//
// Les operations au rattachement ambigu sont exclues jusqu'a decision
// explicite : changement de statut et envoi par email d'un devis, contacts
// et categories d'un client.

export const WRITE_WHITELIST = {
  'Catégories et groupes de catégories (création, modification)': [
    'postCategories',
    'updateCategory',
    'postCategoryGroups',
    'putCategoryGroup',
  ],
  'Clients (création, modification)': [
    'postCompanyCustomer',
    'putCompanyCustomer',
    'postIndividualCustomer',
    'putIndividualCustomer',
  ],
  'Devis (création, modification)': [
    'postQuotes',
    'updateQuote',
  ],
  'Pièces jointes (ajout de fichiers, annexes de devis)': [
    'postFileAttachments',
    'postQuoteAppendices',
  ],
  'Exports (création)': [
    'exportFec',
    'exportGeneralLedger',
    'exportAnalyticalGeneralLedger',
  ],
};

export const WRITE_OPERATION_IDS = new Set(Object.values(WRITE_WHITELIST).flat());

// Abonnements webhook : exclus a tous les niveaux tant que le recepteur
// n'existe pas, lecture comprise. Le scope reste sur le token : seul le
// serveur les exclut.
export const isExcluded = operation => operation.path.startsWith('/webhook_subscriptions');
