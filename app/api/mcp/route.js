// MCP Server Pennylane - Owl Agency
// MVP Phase 1 - 15 tools comptabilité

const TOKEN = process.env.PENNYLANE_API_TOKEN;
const BASE_URL = process.env.PENNYLANE_API_BASE_URL || 'https://app.pennylane.com/api/v2';

if (!TOKEN) {
  console.error('[Pennylane] Token manquant!');
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
// MCP TOOLS DEFINITIONS
// ============================================

const TOOLS = [
  {
    name: 'pennylane_health_check',
    description: 'Vérifier le statut global de la comptabilité Owl Agency via Pennylane. Retourne connexion API, exercices fiscaux, dernières transactions et alertes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pennylane_get_trial_balance',
    description: 'Obtenir la balance générale (trial balance) pour une période donnée. Indispensable pour vérifier l\'équilibre des comptes.',
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
    name: 'pennylane_export_fec',
    description: 'Exporter le Fichier des Écritures Comptables (FEC) pour une période donnée. Format obligatoire pour les contrôles fiscaux en France.',
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
    name: 'pennylane_get_ledger_entries',
    description: 'Récupérer les écritures comptables (ledger entries) pour une période donnée. Utile pour audits et analyses détaillées.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        per_page: { type: 'number', description: 'Nombre de résultats par page (max 100)', default: 50 },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'pennylane_list_customer_invoices',
    description: 'Lister les factures clients (customer invoices) avec filtres optionnels. Essentiel pour le suivi du CA.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        status: { type: 'string', description: 'Statut : draft, pending, paid, late, cancelled', enum: ['draft', 'pending', 'paid', 'late', 'cancelled'] },
        per_page: { type: 'number', description: 'Nombre de résultats par page (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_get_customer_invoice',
    description: 'Obtenir le détail complet d\'une facture client spécifique par son ID.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'ID de la facture client' },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'pennylane_analyze_customer_invoices',
    description: 'Analyser les factures clients : CA total, nombre de factures, factures impayées, délai moyen de paiement, top clients.',
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
    name: 'pennylane_list_supplier_invoices',
    description: 'Lister les factures fournisseurs (supplier invoices) avec filtres optionnels. Essentiel pour le suivi des charges.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        status: { type: 'string', description: 'Statut : draft, pending, paid, late, cancelled', enum: ['draft', 'pending', 'paid', 'late', 'cancelled'] },
        per_page: { type: 'number', description: 'Nombre de résultats par page (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_get_supplier_invoice',
    description: 'Obtenir le détail complet d\'une facture fournisseur spécifique par son ID.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'ID de la facture fournisseur' },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'pennylane_analyze_supplier_invoices',
    description: 'Analyser les factures fournisseurs : charges totales, nombre de factures, factures impayées, top fournisseurs.',
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
    name: 'pennylane_list_transactions',
    description: 'Lister les transactions bancaires (bank transactions) avec filtres optionnels. Utile pour le suivi de trésorerie.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        bank_account_id: { type: 'string', description: 'ID du compte bancaire (optionnel)' },
        matched: { type: 'boolean', description: 'Filtrer par rapprochement : true = rapprochées, false = non rapprochées' },
        per_page: { type: 'number', description: 'Nombre de résultats par page (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_get_bank_reconciliation_status',
    description: 'Obtenir le statut des rapprochements bancaires : nombre de transactions rapprochées vs non rapprochées.',
    inputSchema: {
      type: 'object',
      properties: {
        bank_account_id: { type: 'string', description: 'ID du compte bancaire (optionnel)' },
      },
    },
  },
  {
    name: 'pennylane_list_categories',
    description: 'Lister les catégories comptables analytiques (analytical categories). Utile pour l\'organisation et l\'analyse par projet/service.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pennylane_get_analytical_report',
    description: 'Obtenir un rapport analytique par catégorie pour une période donnée. Permet d\'analyser les revenus et dépenses par catégorie.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
        category_id: { type: 'string', description: 'ID de la catégorie (optionnel)' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'pennylane_get_user_context',
    description: 'Obtenir le contexte utilisateur actuel : profil, entreprise, exercices fiscaux, permissions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

// ============================================
// TOOL IMPLEMENTATIONS
// ============================================

async function executeTool(name, args = {}) {
  console.log(`[MCP] Tool: ${name}`, args);
  
  try {
    switch (name) {
      // 1. Health Check
      case 'pennylane_health_check': {
        const user = await pennylane('/me');
        const fiscalYears = await pennylane('/fiscal_years');
        const txResponse = await pennylane('/transactions?per_page=5&sort=date&direction=desc');
        const transactions = txResponse.transactions || [];
        
        return {
          status: 'ok',
          timestamp: new Date().toISOString(),
          connection: {
            user: { email: user.email, company: user.company?.name },
          },
          fiscalYears: {
            total: fiscalYears.length,
            current: fiscalYears.find(f => f.status === 'open'),
          },
          recentActivity: {
            lastTransactions: transactions.length,
            lastTransactionDate: transactions[0]?.date,
          },
        };
      }
      
      // 2. Trial Balance
      case 'pennylane_get_trial_balance': {
        const { start_date, end_date } = args;
        const data = await pennylane(`/trial_balance?start_date=${start_date}&end_date=${end_date}`);
        return { start_date, end_date, trial_balance: data };
      }
      
      // 3. Export FEC
      case 'pennylane_export_fec': {
        const { start_date, end_date } = args;
        const data = await pennylane(`/fec/export?start_date=${start_date}&end_date=${end_date}`);
        return { start_date, end_date, fec_export: data, note: 'Téléchargez le fichier via l\'URL fournie' };
      }
      
      // 4. Ledger Entries
      case 'pennylane_get_ledger_entries': {
        const { start_date, end_date, per_page = 50 } = args;
        const data = await pennylane(`/ledger_entries?start_date=${start_date}&end_date=${end_date}&per_page=${per_page}`);
        return { start_date, end_date, entries: data };
      }
      
      // 5. List Customer Invoices
      case 'pennylane_list_customer_invoices': {
        const { start_date, end_date, status, per_page = 50 } = args;
        let url = `/customer_invoices?per_page=${per_page}`;
        if (start_date) url += `&start_date=${start_date}`;
        if (end_date) url += `&end_date=${end_date}`;
        if (status) url += `&status=${status}`;
        const data = await pennylane(url);
        return { filters: { start_date, end_date, status }, invoices: data };
      }
      
      // 6. Get Customer Invoice
      case 'pennylane_get_customer_invoice': {
        const { invoice_id } = args;
        const data = await pennylane(`/customer_invoices/${invoice_id}`);
        return { invoice: data };
      }
      
      // 7. Analyze Customer Invoices
      case 'pennylane_analyze_customer_invoices': {
        const { start_date, end_date } = args;
        const response = await pennylane(`/customer_invoices?start_date=${start_date}&end_date=${end_date}&per_page=100`);
        const invoices = response.invoices || response || [];
        
        const analysis = {
          period: { start_date, end_date },
          total_invoices: invoices.length,
          total_revenue: invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0),
          paid_invoices: invoices.filter(inv => inv.status === 'paid').length,
          unpaid_invoices: invoices.filter(inv => ['pending', 'late'].includes(inv.status)).length,
          average_amount: invoices.length > 0 ? invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0) / invoices.length : 0,
        };
        
        return analysis;
      }
      
      // 8. List Supplier Invoices
      case 'pennylane_list_supplier_invoices': {
        const { start_date, end_date, status, per_page = 50 } = args;
        let url = `/supplier_invoices?per_page=${per_page}`;
        if (start_date) url += `&start_date=${start_date}`;
        if (end_date) url += `&end_date=${end_date}`;
        if (status) url += `&status=${status}`;
        const data = await pennylane(url);
        return { filters: { start_date, end_date, status }, invoices: data };
      }
      
      // 9. Get Supplier Invoice
      case 'pennylane_get_supplier_invoice': {
        const { invoice_id } = args;
        const data = await pennylane(`/supplier_invoices/${invoice_id}`);
        return { invoice: data };
      }
      
      // 10. Analyze Supplier Invoices
      case 'pennylane_analyze_supplier_invoices': {
        const { start_date, end_date } = args;
        const response = await pennylane(`/supplier_invoices?start_date=${start_date}&end_date=${end_date}&per_page=100`);
        const invoices = response.invoices || response || [];
        
        const analysis = {
          period: { start_date, end_date },
          total_invoices: invoices.length,
          total_expenses: invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0),
          paid_invoices: invoices.filter(inv => inv.status === 'paid').length,
          unpaid_invoices: invoices.filter(inv => ['pending', 'late'].includes(inv.status)).length,
          average_amount: invoices.length > 0 ? invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0) / invoices.length : 0,
        };
        
        return analysis;
      }
      
      // 11. List Transactions
      case 'pennylane_list_transactions': {
        const { start_date, end_date, bank_account_id, matched, per_page = 50 } = args;
        let url = `/transactions?per_page=${per_page}`;
        if (start_date) url += `&start_date=${start_date}`;
        if (end_date) url += `&end_date=${end_date}`;
        if (bank_account_id) url += `&bank_account_id=${bank_account_id}`;
        if (matched !== undefined) url += `&matched=${matched}`;
        const data = await pennylane(url);
        return { filters: { start_date, end_date, bank_account_id, matched }, transactions: data };
      }
      
      // 12. Bank Reconciliation Status
      case 'pennylane_get_bank_reconciliation_status': {
        const { bank_account_id } = args;
        let url = '/transactions?per_page=1';
        if (bank_account_id) url += `&bank_account_id=${bank_account_id}`;
        
        const matchedResponse = await pennylane(url + '&matched=true');
        const unmatchedResponse = await pennylane(url + '&matched=false');
        
        return {
          bank_account_id: bank_account_id || 'all',
          matched_transactions: matchedResponse.total || 0,
          unmatched_transactions: unmatchedResponse.total || 0,
          reconciliation_rate: matchedResponse.total / (matchedResponse.total + unmatchedResponse.total) * 100,
        };
      }
      
      // 13. List Categories
      case 'pennylane_list_categories': {
        const data = await pennylane('/categories');
        return { categories: data };
      }
      
      // 14. Analytical Report
      case 'pennylane_get_analytical_report': {
        const { start_date, end_date, category_id } = args;
        let url = `/analytical_report?start_date=${start_date}&end_date=${end_date}`;
        if (category_id) url += `&category_id=${category_id}`;
        const data = await pennylane(url);
        return { period: { start_date, end_date }, category_id, report: data };
      }
      
      // 15. User Context
      case 'pennylane_get_user_context': {
        const user = await pennylane('/me');
        const fiscalYears = await pennylane('/fiscal_years');
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
          current_fiscal_year: fiscalYears.find(f => f.status === 'open'),
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`[MCP] Tool error:`, error);
    return {
      error: true,
      message: error.message,
      tool: name,
    };
  }
}

// ============================================
// MCP PROTOCOL HANDLER
// ============================================

export async function POST(request) {
  try {
    const { jsonrpc, id, method, params } = await request.json();
    
    console.log(`[MCP] ${method}`);
    
    if (jsonrpc !== '2.0') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid JSON-RPC' },
      });
    }
    
    // Initialize
    if (method === 'initialize') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mcp-pennylane-owl', version: '1.0.0' },
        },
      });
    }
    
    // Initialized notification
    if (method === 'notifications/initialized') {
      return Response.json({ jsonrpc: '2.0' });
    }
    
    // List tools
    if (method === 'tools/list') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
    }
    
    // Call tool
    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params;
      const result = await executeTool(name, toolArgs || {});
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    }
    
    // Unknown method
    return Response.json({
      jsonrpc: '2.0',
      id,
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

// Handler GET (status)
export async function GET() {
  return Response.json({
    name: 'mcp-pennylane-owl',
    version: '1.0.0',
    status: 'running',
    tools_count: TOOLS.length,
    tools: TOOLS.map(t => t.name),
  });
}
