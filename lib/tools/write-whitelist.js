// Liste blanche des ecritures accessibles par pennylane_call_operation, par
// domaine. Toute operation qui n'est pas une lecture (GET) et n'y figure pas
// est refusee. Interdit en toutes circonstances : transactions, ecritures
// comptables, et tout domaine hors de cette liste.
//
// Factures clients : brouillons uniquement, garde-fou applique dans
// lib/write-guards.js. Restent exclus : finalisation, tout envoi (email d'un
// devis ou d'une facture, transmission a la plateforme agreee), marquage
// comme payee, rapprochements, categories d'un client, produits.

export const WRITE_WHITELIST = {
  'Catégories et groupes de catégories (création, modification)': [
    'postCategories',
    'updateCategory',
    'postCategoryGroups',
    'putCategoryGroup',
  ],
  'Clients et contacts (création, modification)': [
    'postCompanyCustomer',
    'putCompanyCustomer',
    'postIndividualCustomer',
    'putIndividualCustomer',
    'postCustomerContact',
    'putCustomerContact',
  ],
  'Devis (création, modification, changement de statut)': [
    'postQuotes',
    'updateQuote',
    'updateStatusQuote',
  ],
  'Factures clients en brouillon (création, création depuis un devis, modification, suppression)': [
    'postCustomerInvoices',
    'createCustomerInvoiceFromQuote',
    'updateCustomerInvoice',
    'deleteCustomerInvoices',
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
