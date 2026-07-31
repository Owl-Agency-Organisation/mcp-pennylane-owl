// MCP Server Pennylane - Owl Agency
// v1.2.0 - 21 Tools - API v2 External

const SERVER_VERSION = '1.2.0';

const TOKEN = process.env.PENNYLANE_API_TOKEN;
const BASE_URL = process.env.PENNYLANE_API_BASE_URL || 'https://app.pennylane.com/api/external/v2';
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!TOKEN) {
  console.error('[Pennylane] Token manquant!');
}

if (!MCP_AUTH_TOKEN) {
  console.error('[MCP] MCP_AUTH_TOKEN manquant : le serveur refusera toutes les requetes.');
}

// Revisions du protocole MCP que ce serveur sait servir, de la plus recente
// a la plus ancienne. On renvoie celle demandee par le client si on la
// connait, sinon la plus recente.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// ============================================
// HELPERS
// ============================================

// Comparaison a temps constant, sans dependance a node:crypto (le runtime
// de la route peut etre node ou edge selon la config Vercel).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

// Le token peut arriver via `Authorization: Bearer ...` (standard MCP) ou
// via `X-MCP-Token` pour les clients qui ne laissent pas personnaliser
// l'en-tete Authorization.
function isAuthorized(request) {
  if (!MCP_AUTH_TOKEN) return false;
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (bearer && safeEqual(bearer, MCP_AUTH_TOKEN)) return true;
  const custom = (request.headers.get('x-mcp-token') || '').trim();
  return Boolean(custom) && safeEqual(custom, MCP_AUTH_TOKEN);
}

// L'API Pennylane renvoie tantot un tableau brut, tantot un objet pagine.
// Cette normalisation evite les `.length` / `.find()` sur un objet.
function asArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['items', ...keys]) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

// L'API plafonne la pagination a 100 elements par page.
function clampLimit(limit, fallback = 50) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

// ============================================
// PENNYLANE API CLIENT
// ============================================

async function pennylane(endpoint, options = {}) {
  console.log(`[Pennylane] ${options.method || 'GET'} ${endpoint}`);
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Pennylane API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

// ============================================
// MCP TOOLS DEFINITIONS (21 tools)
// ============================================

const TOOLS = [
  // MONITORING (1)
  {
    name: 'pennylane_health_check',
    description: 'Vérifier le statut global de la comptabilité Owl Agency via Pennylane. Retourne connexion API, exercices fiscaux, dernières transactions et alertes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  
  // FACTURES CLIENTS (4)
  {
    name: 'pennylane_list_customer_invoices',
    description: 'Lister les factures clients avec filtres par date. Essentiel pour le suivi du CA.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_analyze_customer_invoices',
    description: 'Analyser les factures clients : CA total, nombre de factures, impayés.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'pennylane_get_customer_invoice',
    description: 'Obtenir le détail complet d\'une facture client par son ID.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'ID de la facture client' },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'pennylane_get_customer_invoice_matched_transactions',
    description: 'Obtenir les transactions bancaires rapprochées à une facture client. Permet de vérifier qu\'une facture a bien été payée et encaissée.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'ID de la facture client' },
      },
      required: ['invoice_id'],
    },
  },
  
  // FACTURES FOURNISSEURS (3)
  {
    name: 'pennylane_list_supplier_invoices',
    description: 'Lister les factures fournisseurs avec filtres par date. Essentiel pour le suivi des charges.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_analyze_supplier_invoices',
    description: 'Analyser les factures fournisseurs : charges totales, nombre de factures, impayés.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'pennylane_get_supplier_invoice',
    description: 'Obtenir le détail complet d\'une facture fournisseur par son ID.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'ID de la facture fournisseur' },
      },
      required: ['invoice_id'],
    },
  },
  
  // TRÉSORERIE (2)
  {
    name: 'pennylane_list_transactions',
    description: 'Lister les transactions bancaires avec filtres optionnels. Utile pour le suivi de trésorerie.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_list_bank_accounts',
    description: 'Lister les comptes bancaires configurés dans Pennylane avec leurs soldes et statuts de connexion.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  
  // CONTACTS (2)
  {
    name: 'pennylane_get_customers',
    description: 'Lister tous les clients enregistrés dans Pennylane.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_get_suppliers',
    description: 'Lister tous les fournisseurs enregistrés dans Pennylane.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  
  // COMPTABILITÉ (5)
  {
    name: 'pennylane_list_categories',
    description: 'Lister les catégories comptables analytiques. Utile pour l\'organisation par projet/service.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_list_ledger_entries',
    description: 'Lister les écritures comptables pour une période. Utile pour audits et analyses détaillées.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_list_products',
    description: 'Lister tous les produits/services du catalogue Pennylane.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_list_journals',
    description: 'Lister les journaux comptables (ventes, achats, banque, opérations diverses). Essentiel pour comprendre l\'organisation comptable.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_list_ledger_accounts',
    description: 'Lister les comptes du plan comptable (classes 1 à 7). Permet de voir tous les comptes utilisés.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  
  // COMMERCIAL (1)
  {
    name: 'pennylane_list_quotes',
    description: 'Lister les devis avec filtres optionnels par date.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  
  // CONTEXTE & EXPORTS (3)
  {
    name: 'pennylane_get_user_context',
    description: 'Obtenir le contexte utilisateur actuel : profil, entreprise, exercices fiscaux.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pennylane_list_fiscal_years',
    description: 'Lister tous les exercices fiscaux de l\'entreprise (ouverts, fermés, dates début/fin).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_export_fec',
    description: 'Générer et télécharger l\'export FEC (Fichier des Écritures Comptables) pour une période. Obligatoire pour contrôles fiscaux en France.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
      },
      required: ['start_date', 'end_date'],
    },
  },
];

// ============================================
// TOOL IMPLEMENTATIONS
// ============================================

async function executeTool(name, args = {}) {
  console.log(`[MCP] Tool: ${name}`, args);
  
  try {
    switch (name) {
      case 'pennylane_health_check': {
        const user = await pennylane('/me');
        const fiscalYearsData = await pennylane('/fiscal_years');
        const fiscalYears = asArray(fiscalYearsData, 'fiscal_years');
        const txData = await pennylane('/transactions?limit=5');
        const transactions = asArray(txData, 'transactions');

        return {
          status: 'ok',
          timestamp: new Date().toISOString(),
          connection: {
            user: { email: user.email, company: user.company?.name },
          },
          fiscalYears: {
            total: fiscalYears.length,
            current: fiscalYears.find(f => f.status === 'open') || null,
          },
          recentActivity: {
            lastTransactions: transactions.length,
            lastTransactionDate: transactions[0]?.date,
          },
        };
      }
      
      case 'pennylane_list_customer_invoices': {
        const { start_date, end_date, limit = 50 } = args;
        const filters = [];
        if (start_date) filters.push({ field: 'date', operator: 'gteq', value: start_date });
        if (end_date) filters.push({ field: 'date', operator: 'lteq', value: end_date });
        
        let url = `/customer_invoices?limit=${clampLimit(limit)}`;
        if (filters.length > 0) url += `&filter=${encodeURIComponent(JSON.stringify(filters))}`;
        
        const data = await pennylane(url);
        const invoices = asArray(data, 'invoices');
        return { filters: { start_date, end_date }, count: invoices.length, invoices };
      }
      
      case 'pennylane_analyze_customer_invoices': {
        const { start_date, end_date } = args;
        const filters = [
          { field: 'date', operator: 'gteq', value: start_date },
          { field: 'date', operator: 'lteq', value: end_date },
        ];
        
        const url = `/customer_invoices?limit=100&filter=${encodeURIComponent(JSON.stringify(filters))}`;
        const data = await pennylane(url);
        const invoices = asArray(data, 'invoices');
        
        const totalRevenue = invoices.reduce((sum, inv) => sum + parseFloat(inv.amount || inv.total_amount || 0), 0);
        const paidInvoices = invoices.filter(inv => inv.status === 'paid' || inv.payment_status === 'paid');
        const unpaidInvoices = invoices.filter(inv => ['pending', 'late', 'unpaid'].includes(inv.status || inv.payment_status));
        
        return {
          period: { start_date, end_date },
          summary: {
            total_invoices: invoices.length,
            total_revenue: totalRevenue,
            average_invoice_amount: invoices.length > 0 ? totalRevenue / invoices.length : 0,
          },
          payment_status: {
            paid: paidInvoices.length,
            unpaid: unpaidInvoices.length,
            paid_amount: paidInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || inv.total_amount || 0), 0),
            unpaid_amount: unpaidInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || inv.total_amount || 0), 0),
          },
          invoices: invoices.slice(0, 10),
        };
      }
      
      case 'pennylane_get_customer_invoice': {
        const { invoice_id } = args;
        const invoice = await pennylane(`/customer_invoices/${invoice_id}`);
        return { invoice };
      }
      
      case 'pennylane_get_customer_invoice_matched_transactions': {
        const { invoice_id } = args;
        const data = await pennylane(`/customer_invoices/${invoice_id}/matched_transactions`);
        const transactions = asArray(data, 'matched_transactions');
        return {
          invoice_id,
          matched_transactions_count: transactions.length,
          matched_transactions: transactions,
        };
      }
      
      case 'pennylane_list_supplier_invoices': {
        const { start_date, end_date, limit = 50 } = args;
        const filters = [];
        if (start_date) filters.push({ field: 'date', operator: 'gteq', value: start_date });
        if (end_date) filters.push({ field: 'date', operator: 'lteq', value: end_date });
        
        let url = `/supplier_invoices?limit=${clampLimit(limit)}`;
        if (filters.length > 0) url += `&filter=${encodeURIComponent(JSON.stringify(filters))}`;
        
        const data = await pennylane(url);
        const invoices = asArray(data, 'invoices');
        return { filters: { start_date, end_date }, count: invoices.length, invoices };
      }
      
      case 'pennylane_analyze_supplier_invoices': {
        const { start_date, end_date } = args;
        const filters = [
          { field: 'date', operator: 'gteq', value: start_date },
          { field: 'date', operator: 'lteq', value: end_date },
        ];
        
        const url = `/supplier_invoices?limit=100&filter=${encodeURIComponent(JSON.stringify(filters))}`;
        const data = await pennylane(url);
        const invoices = asArray(data, 'invoices');
        
        const totalExpenses = invoices.reduce((sum, inv) => sum + parseFloat(inv.amount || inv.total_amount || 0), 0);
        const paidInvoices = invoices.filter(inv => inv.status === 'paid' || inv.payment_status === 'paid');
        const unpaidInvoices = invoices.filter(inv => ['pending', 'late', 'unpaid'].includes(inv.status || inv.payment_status));
        
        return {
          period: { start_date, end_date },
          summary: {
            total_invoices: invoices.length,
            total_expenses: totalExpenses,
            average_invoice_amount: invoices.length > 0 ? totalExpenses / invoices.length : 0,
          },
          payment_status: {
            paid: paidInvoices.length,
            unpaid: unpaidInvoices.length,
            paid_amount: paidInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || inv.total_amount || 0), 0),
            unpaid_amount: unpaidInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || inv.total_amount || 0), 0),
          },
          invoices: invoices.slice(0, 10),
        };
      }
      
      case 'pennylane_get_supplier_invoice': {
        const { invoice_id } = args;
        const invoice = await pennylane(`/supplier_invoices/${invoice_id}`);
        return { invoice };
      }
      
      case 'pennylane_list_transactions': {
        const { start_date, end_date, limit = 50 } = args;
        const filters = [];
        if (start_date) filters.push({ field: 'date', operator: 'gteq', value: start_date });
        if (end_date) filters.push({ field: 'date', operator: 'lteq', value: end_date });
        
        let url = `/transactions?limit=${clampLimit(limit)}`;
        if (filters.length > 0) url += `&filter=${encodeURIComponent(JSON.stringify(filters))}`;
        
        const data = await pennylane(url);
        const transactions = asArray(data, 'transactions');
        return { filters: { start_date, end_date }, count: transactions.length, transactions };
      }
      
      case 'pennylane_list_bank_accounts': {
        const { limit = 50 } = args;
        const data = await pennylane(`/bank_accounts?limit=${clampLimit(limit)}`);
        const accounts = asArray(data, 'bank_accounts');
        return { count: accounts.length, bank_accounts: accounts };
      }
      
      case 'pennylane_get_customers': {
        const { limit = 50 } = args;
        const data = await pennylane(`/customers?limit=${clampLimit(limit)}`);
        const customers = asArray(data, 'customers');
        return { count: customers.length, customers };
      }
      
      case 'pennylane_get_suppliers': {
        const { limit = 50 } = args;
        const data = await pennylane(`/suppliers?limit=${clampLimit(limit)}`);
        const suppliers = asArray(data, 'suppliers');
        return { count: suppliers.length, suppliers };
      }
      
      case 'pennylane_list_categories': {
        const { limit = 50 } = args;
        const data = await pennylane(`/categories?limit=${clampLimit(limit)}`);
        const categories = asArray(data, 'categories');
        return { count: categories.length, categories };
      }
      
      case 'pennylane_list_ledger_entries': {
        const { start_date, end_date, limit = 50 } = args;
        const filters = [];
        if (start_date) filters.push({ field: 'date', operator: 'gteq', value: start_date });
        if (end_date) filters.push({ field: 'date', operator: 'lteq', value: end_date });
        
        let url = `/ledger_entries?limit=${clampLimit(limit)}`;
        if (filters.length > 0) url += `&filter=${encodeURIComponent(JSON.stringify(filters))}`;
        
        const data = await pennylane(url);
        const entries = asArray(data, 'ledger_entries');
        return { filters: { start_date, end_date }, count: entries.length, entries };
      }
      
      case 'pennylane_list_products': {
        const { limit = 50 } = args;
        const data = await pennylane(`/products?limit=${clampLimit(limit)}`);
        const products = asArray(data, 'products');
        return { count: products.length, products };
      }
      
      case 'pennylane_list_journals': {
        const { limit = 50 } = args;
        const data = await pennylane(`/journals?limit=${clampLimit(limit)}`);
        const journals = asArray(data, 'journals');
        return { count: journals.length, journals };
      }
      
      case 'pennylane_list_ledger_accounts': {
        const { limit = 50 } = args;
        const data = await pennylane(`/ledger_accounts?limit=${clampLimit(limit)}`);
        const accounts = asArray(data, 'ledger_accounts');
        return { count: accounts.length, ledger_accounts: accounts };
      }
      
      case 'pennylane_list_quotes': {
        const { start_date, end_date, limit = 50 } = args;
        const filters = [];
        if (start_date) filters.push({ field: 'date', operator: 'gteq', value: start_date });
        if (end_date) filters.push({ field: 'date', operator: 'lteq', value: end_date });
        
        let url = `/quotes?limit=${clampLimit(limit)}`;
        if (filters.length > 0) url += `&filter=${encodeURIComponent(JSON.stringify(filters))}`;
        
        const data = await pennylane(url);
        const quotes = asArray(data, 'quotes');
        return { filters: { start_date, end_date }, count: quotes.length, quotes };
      }
      
      case 'pennylane_get_user_context': {
        const user = await pennylane('/me');
        const fiscalYearsData = await pennylane('/fiscal_years');
        const fiscalYears = asArray(fiscalYearsData, 'fiscal_years');
        const company = user.company || {};
        
        return {
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
          },
          company: {
            name: company.name,
            siret: company.siret,
            vat_number: company.vat_number,
          },
          fiscal_years: fiscalYears,
          current_fiscal_year: fiscalYears.find(f => f.status === 'open') || null,
        };
      }
      
      case 'pennylane_list_fiscal_years': {
        const { limit = 50 } = args;
        const data = await pennylane(`/fiscal_years?limit=${clampLimit(limit)}`);
        const fiscalYears = asArray(data, 'fiscal_years');
        return { count: fiscalYears.length, fiscal_years: fiscalYears };
      }
      
      case 'pennylane_export_fec': {
        const { start_date, end_date } = args;
        const data = await pennylane(`/exports/fec`, {
          method: 'POST',
          body: { start_date, end_date },
        });
        return {
          period: { start_date, end_date },
          export_status: 'generated',
          download_url: data.download_url || data.url,
          note: 'Utilisez le download_url pour télécharger le fichier FEC',
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`[MCP] Tool error:`, error);
    // __mcpError sert uniquement au handler pour positionner `isError`,
    // il est retire avant serialisation.
    return {
      __mcpError: true,
      error: true,
      message: error.message,
      tool: name,
    };
  }
}

// ============================================
// MCP PROTOCOL HANDLER
// ============================================

function unauthorized() {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized' },
    },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="mcp-pennylane-owl"' } },
  );
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    console.warn('[MCP] Requete refusee : token absent ou invalide.');
    return unauthorized();
  }

  try {
    const { jsonrpc, id, method, params } = await request.json();

    console.log(`[MCP] ${method}`);

    if (jsonrpc !== '2.0') {
      return Response.json({
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32600, message: 'Invalid JSON-RPC' },
      });
    }

    // Une notification JSON-RPC n'a pas d'id et ne doit recevoir aucune
    // reponse : 202 sans corps.
    if (typeof method === 'string' && method.startsWith('notifications/')) {
      return new Response(null, { status: 202 });
    }

    if (method === 'initialize') {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];

      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'mcp-pennylane-owl', version: SERVER_VERSION },
        },
      });
    }

    if (method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
    }

    if (method === 'tools/call') {
      const name = params?.name;
      if (!name) {
        return Response.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name' },
        });
      }

      const result = await executeTool(name, params.arguments || {});
      const isError = Boolean(result?.__mcpError);
      if (isError) delete result.__mcpError;

      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError,
        },
      });
    }

    return Response.json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32601, message: `Unknown method: ${method}` },
    });
  } catch (error) {
    console.error('[MCP] Error:', error);
    return Response.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  }
}

// Ping public volontairement minimal : il ne revele ni la liste des tools
// ni la configuration. Le detail exige le meme token que POST.
export async function GET(request) {
  if (!isAuthorized(request)) {
    return Response.json({ name: 'mcp-pennylane-owl', status: 'running' });
  }

  return Response.json({
    name: 'mcp-pennylane-owl',
    version: SERVER_VERSION,
    status: 'running',
    api_version: 'v2 external',
    pennylane_token_configured: Boolean(TOKEN),
    tools_count: TOOLS.length,
    tools: TOOLS.map(t => t.name),
  });
}
