// MCP Server Pennylane - Owl Agency
// MVP Phase 1 - 15 tools comptabilité

const TOKEN = process.env.PENNYLANE_API_TOKEN;
const BASE_URL = process.env.PENNYLANE_API_BASE_URL || 'https://app.pennylane.com/api/external/v2';

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
    name: 'pennylane_list_customer_invoices',
    description: 'Lister les factures clients (customer invoices) avec filtres optionnels par date. Essentiel pour le suivi du CA.',
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
    description: 'Analyser les factures clients : CA total, nombre de factures, factures impayées pour une période donnée.',
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
    name: 'pennylane_list_supplier_invoices',
    description: 'Lister les factures fournisseurs (supplier invoices) avec filtres optionnels par date. Essentiel pour le suivi des charges.',
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
    description: 'Analyser les factures fournisseurs : charges totales, nombre de factures, factures impayées pour une période.',
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
    name: 'pennylane_list_transactions',
    description: 'Lister les transactions bancaires (bank transactions) avec filtres optionnels. Utile pour le suivi de trésorerie.',
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
    name: 'pennylane_get_customers',
    description: 'Lister tous les clients (customers) enregistrés dans Pennylane.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Nombre de résultats (max 100)', default: 50 },
      },
    },
  },
  {
    name: 'pennylane_get_user_context',
    description: 'Obtenir le contexte utilisateur actuel : profil, entreprise, exercices fiscaux.',
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
        
        // Récupérer transactions récentes (avec filtres)
        const txData = await pennylane('/transactions?limit=5&sort=-date');
        const transactions = txData.items || txData.transactions || txData || [];
        
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
      
      // 2. List Customer Invoices
      case 'pennylane_list_customer_invoices': {
        const { start_date, end_date, limit = 50 } = args;
        
        // Construire filtres
        const filters = [];
        if (start_date) {
          filters.push({ field: 'date', operator: 'gteq', value: start_date });
        }
        if (end_date) {
          filters.push({ field: 'date', operator: 'lteq', value: end_date });
        }
        
        let url = `/customer_invoices?limit=${limit}`;
        if (filters.length > 0) {
          url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;
        }
        
        const data = await pennylane(url);
        const invoices = data.items || data.invoices || data || [];
        
        return {
          filters: { start_date, end_date },
          count: invoices.length,
          invoices,
        };
      }
      
      // 3. Analyze Customer Invoices
      case 'pennylane_analyze_customer_invoices': {
        const { start_date, end_date } = args;
        
        const filters = [
          { field: 'date', operator: 'gteq', value: start_date },
          { field: 'date', operator: 'lteq', value: end_date },
        ];
        
        const url = `/customer_invoices?limit=100&filters=${encodeURIComponent(JSON.stringify(filters))}`;
        const data = await pennylane(url);
        const invoices = data.items || data.invoices || data || [];
        
        // Calculer statistiques
        const totalRevenue = invoices.reduce((sum, inv) => {
          const amount = inv.amount || inv.total_amount || 0;
          return sum + amount;
        }, 0);
        
        const paidInvoices = invoices.filter(inv => 
          inv.status === 'paid' || inv.payment_status === 'paid'
        );
        
        const unpaidInvoices = invoices.filter(inv => 
          ['pending', 'late', 'unpaid'].includes(inv.status || inv.payment_status)
        );
        
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
            paid_amount: paidInvoices.reduce((sum, inv) => sum + (inv.amount || inv.total_amount || 0), 0),
            unpaid_amount: unpaidInvoices.reduce((sum, inv) => sum + (inv.amount || inv.total_amount || 0), 0),
          },
          invoices: invoices.slice(0, 10), // Retourner top 10 pour exemple
        };
      }
      
      // 4. Get Customer Invoice
      case 'pennylane_get_customer_invoice': {
        const { invoice_id } = args;
        const invoice = await pennylane(`/customer_invoices/${invoice_id}`);
        return { invoice };
      }
      
      // 5. List Supplier Invoices
      case 'pennylane_list_supplier_invoices': {
        const { start_date, end_date, limit = 50 } = args;
        
        const filters = [];
        if (start_date) {
          filters.push({ field: 'date', operator: 'gteq', value: start_date });
        }
        if (end_date) {
          filters.push({ field: 'date', operator: 'lteq', value: end_date });
        }
        
        let url = `/supplier_invoices?limit=${limit}`;
        if (filters.length > 0) {
          url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;
        }
        
        const data = await pennylane(url);
        const invoices = data.items || data.invoices || data || [];
        
        return {
          filters: { start_date, end_date },
          count: invoices.length,
          invoices,
        };
      }
      
      // 6. Analyze Supplier Invoices
      case 'pennylane_analyze_supplier_invoices': {
        const { start_date, end_date } = args;
        
        const filters = [
          { field: 'date', operator: 'gteq', value: start_date },
          { field: 'date', operator: 'lteq', value: end_date },
        ];
        
        const url = `/supplier_invoices?limit=100&filters=${encodeURIComponent(JSON.stringify(filters))}`;
        const data = await pennylane(url);
        const invoices = data.items || data.invoices || data || [];
        
        const totalExpenses = invoices.reduce((sum, inv) => {
          const amount = inv.amount || inv.total_amount || 0;
          return sum + amount;
        }, 0);
        
        const paidInvoices = invoices.filter(inv => 
          inv.status === 'paid' || inv.payment_status === 'paid'
        );
        
        const unpaidInvoices = invoices.filter(inv => 
          ['pending', 'late', 'unpaid'].includes(inv.status || inv.payment_status)
        );
        
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
            paid_amount: paidInvoices.reduce((sum, inv) => sum + (inv.amount || inv.total_amount || 0), 0),
            unpaid_amount: unpaidInvoices.reduce((sum, inv) => sum + (inv.amount || inv.total_amount || 0), 0),
          },
          invoices: invoices.slice(0, 10),
        };
      }
      
      // 7. Get Supplier Invoice
      case 'pennylane_get_supplier_invoice': {
        const { invoice_id } = args;
        const invoice = await pennylane(`/supplier_invoices/${invoice_id}`);
        return { invoice };
      }
      
      // 8. List Transactions
      case 'pennylane_list_transactions': {
        const { start_date, end_date, limit = 50 } = args;
        
        const filters = [];
        if (start_date) {
          filters.push({ field: 'date', operator: 'gteq', value: start_date });
        }
        if (end_date) {
          filters.push({ field: 'date', operator: 'lteq', value: end_date });
        }
        
        let url = `/transactions?limit=${limit}`;
        if (filters.length > 0) {
          url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;
        }
        
        const data = await pennylane(url);
        const transactions = data.items || data.transactions || data || [];
        
        return {
          filters: { start_date, end_date },
          count: transactions.length,
          transactions,
        };
      }
      
      // 9. Get Customers
      case 'pennylane_get_customers': {
        const { limit = 50 } = args;
        const data = await pennylane(`/customers?limit=${limit}`);
        const customers = data.items || data.customers || data || [];
        
        return {
          count: customers.length,
          customers,
        };
      }
      
      // 10. User Context
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
