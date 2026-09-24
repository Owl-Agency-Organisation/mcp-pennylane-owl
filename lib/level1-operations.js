// Operations de l'API appelees par les outils de niveau 1. Le build echoue si
// l'une d'elles disparait de la spec : scripts/generate-registry.mjs --check,
// lance avant chaque build.
export const LEVEL1_OPERATION_IDS = [
  'getMe',
  'company-fiscal-years',
  'getTransactions',
  'getCustomerInvoices',
  'getCustomerInvoice',
  'getCustomerInvoiceMatchedTransactions',
  'getSupplierInvoices',
  'getSupplierInvoice',
  'getBankAccounts',
  'getCustomers',
  'getSuppliers',
  'getCategories',
  'getLedgerEntries',
  'getProducts',
  'getJournals',
  'getLedgerAccounts',
  'listQuotes',
  'exportFec',
  'getFecExport',
];
