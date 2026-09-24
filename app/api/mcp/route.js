// Serveur MCP Pennylane — 22 tools sur l'API v2 external.
// Endpoint JSON-RPC unique, compatible avec tout client MCP parlant HTTP.
// https://github.com/Owl-Agency-Organisation/mcp-pennylane-owl

import { createPennylaneClient } from '../../../lib/pennylane.js';
import {
  asArray,
  paginate,
  FETCH_ALL_MAX_PAGES,
  FETCH_ALL_TIME_BUDGET_MS,
  FETCH_ALL_MAX_CHARS,
} from '../../../lib/pagination.js';
import { oauthFromEnv } from '../../../lib/oauth/env.js';

const SERVER_VERSION = '1.4.0';

const TOKEN = process.env.PENNYLANE_API_TOKEN;
const BASE_URL = process.env.PENNYLANE_API_BASE_URL || 'https://app.pennylane.com/api/external/v2';
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!TOKEN) {
  console.error('[Pennylane] Token manquant!');
}

if (!MCP_AUTH_TOKEN) {
  console.error('[MCP] MCP_AUTH_TOKEN manquant : le secret partage est refuse.');
}

// Serveur d'autorisation OAuth, ou null s'il n'est pas configure : seul le
// secret partage est alors accepte.
const oauth = oauthFromEnv();

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

// Deux credentials acceptes :
// - le secret partage, via `Authorization: Bearer ...` (standard MCP) ou via
//   `X-MCP-Token` pour les clients qui ne laissent pas personnaliser
//   l'en-tete Authorization ;
// - un jeton d'acces OAuth emis par notre serveur d'autorisation pour cette
//   ressource.
async function isAuthorized(request) {
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (MCP_AUTH_TOKEN) {
    if (bearer && safeEqual(bearer, MCP_AUTH_TOKEN)) return true;
    const custom = (request.headers.get('x-mcp-token') || '').trim();
    if (custom && safeEqual(custom, MCP_AUTH_TOKEN)) return true;
  }
  if (oauth && bearer) return Boolean(await oauth.verifyAccessToken(bearer));
  return false;
}

// Un exercice porte `start`, `finish` et un `status` parmi open, reopen,
// closed, frozen. Plusieurs exercices peuvent etre ouverts simultanement :
// Pennylane cree les exercices a venir a l'avance. Se contenter du premier
// `open` de la liste designe donc un exercice futur comme etant le courant.
// On cherche d'abord celui dont la periode contient la date du jour.
// Les dates sont au format YYYY-MM-DD : la comparaison lexicographique
// equivaut a la comparaison chronologique.
function findCurrentFiscalYear(fiscalYears, today = new Date().toISOString().slice(0, 10)) {
  const inRange = fiscalYears.find(f => f.start && f.finish && f.start <= today && today <= f.finish);
  if (inRange) return inRange;
  // Repli : aucun exercice ne couvre aujourd'hui (trou de parametrage).
  return fiscalYears.find(f => f.status === 'open' || f.status === 'reopen') || null;
}

// L'API plafonne la pagination a 100 elements par page.
function clampLimit(limit, fallback = 50) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function dateFilters(start_date, end_date) {
  const filters = [];
  if (start_date) filters.push({ field: 'date', operator: 'gteq', value: start_date });
  if (end_date) filters.push({ field: 'date', operator: 'lteq', value: end_date });
  return filters;
}

// ============================================
// PENNYLANE API CLIENT
// ============================================

// Cadence les appels sous la limite de debit et reprend apres un 429.
const pennylane = createPennylaneClient({ baseUrl: BASE_URL, token: TOKEN });

// Outil de liste : une page, ou les suivantes avec fetch_all. Le curseur ne
// memorise pas les filtres : ils sont renvoyes a chaque page.
function listTool(endpoint, args, { filters = [], itemKeys = [] } = {}) {
  const { limit = 50, cursor, fetch_all = false } = args;
  const base = new URLSearchParams({ limit: String(clampLimit(limit)) });
  if (filters.length > 0) base.set('filter', JSON.stringify(filters));

  return paginate(
    pageCursor => {
      const query = new URLSearchParams(base);
      if (pageCursor) query.set('cursor', pageCursor);
      return pennylane(`${endpoint}?${query}`);
    },
    { cursor: typeof cursor === 'string' ? cursor : null, fetchAll: fetch_all === true, itemKeys },
  );
}

// ============================================
// MCP TOOLS DEFINITIONS (22 tools)
// ============================================

// Parametres communs a tous les outils de liste. La reponse est toujours
// l'enveloppe { items, count, has_more, next_cursor, truncated }.
const PAGINATION_PROPERTIES = {
  limit: { type: 'number', description: 'Taille de page, de 1 à 100 (50 par défaut)', default: 50 },
  cursor: {
    type: 'string',
    description: 'Valeur next_cursor d\'une réponse précédente, pour lire la page suivante. Renvoyer les mêmes filtres.',
  },
  fetch_all: {
    type: 'boolean',
    description: `Lire aussi les pages suivantes, dans la limite de ${FETCH_ALL_MAX_PAGES} pages, ${FETCH_ALL_TIME_BUDGET_MS / 1000} s et ${FETCH_ALL_MAX_CHARS.toLocaleString('fr-FR')} caractères. Si la liste reste incomplète : truncated = true, et next_cursor permet de reprendre.`,
    default: false,
  },
};

const DATE_FILTER_PROPERTIES = {
  start_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
  end_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
};

const TOOLS = [
  // MONITORING (1)
  {
    name: 'pennylane_health_check',
    description: 'Vérifier le statut global de la comptabilité connectée à Pennylane : validité de la connexion API, exercices fiscaux et dernières transactions. À appeler en premier pour diagnostiquer un problème de connexion.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  
  // FACTURES CLIENTS (4)
  {
    name: 'pennylane_list_customer_invoices',
    description: 'Lister les factures clients avec filtres par date. Essentiel pour le suivi du CA.',
    inputSchema: {
      type: 'object',
      properties: { ...DATE_FILTER_PROPERTIES, ...PAGINATION_PROPERTIES },
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
        ...PAGINATION_PROPERTIES,
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
      properties: { ...DATE_FILTER_PROPERTIES, ...PAGINATION_PROPERTIES },
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
      properties: { ...DATE_FILTER_PROPERTIES, ...PAGINATION_PROPERTIES },
    },
  },
  {
    name: 'pennylane_list_bank_accounts',
    description: 'Lister les comptes bancaires configurés dans Pennylane avec leurs soldes et statuts de connexion.',
    inputSchema: {
      type: 'object',
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  
  // CONTACTS (2)
  {
    name: 'pennylane_get_customers',
    description: 'Lister tous les clients enregistrés dans Pennylane.',
    inputSchema: {
      type: 'object',
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  {
    name: 'pennylane_get_suppliers',
    description: 'Lister tous les fournisseurs enregistrés dans Pennylane.',
    inputSchema: {
      type: 'object',
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  
  // COMPTABILITÉ (5)
  {
    name: 'pennylane_list_categories',
    description: 'Lister les catégories comptables analytiques. Utile pour l\'organisation par projet/service.',
    inputSchema: {
      type: 'object',
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  {
    name: 'pennylane_list_ledger_entries',
    description: 'Lister les écritures comptables pour une période. Utile pour audits et analyses détaillées.',
    inputSchema: {
      type: 'object',
      properties: { ...DATE_FILTER_PROPERTIES, ...PAGINATION_PROPERTIES },
    },
  },
  {
    name: 'pennylane_list_products',
    description: 'Lister tous les produits/services du catalogue Pennylane.',
    inputSchema: {
      type: 'object',
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  {
    name: 'pennylane_list_journals',
    description: 'Lister les journaux comptables (ventes, achats, banque, opérations diverses). Essentiel pour comprendre l\'organisation comptable.',
    inputSchema: {
      type: 'object',
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  {
    name: 'pennylane_list_ledger_accounts',
    description: 'Lister les comptes du plan comptable (classes 1 à 7). Permet de voir tous les comptes utilisés.',
    inputSchema: {
      type: 'object',
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  
  // COMMERCIAL (1)
  {
    name: 'pennylane_list_quotes',
    description: 'Lister les devis avec filtres optionnels par date.',
    inputSchema: {
      type: 'object',
      properties: { ...DATE_FILTER_PROPERTIES, ...PAGINATION_PROPERTIES },
    },
  },
  
  // CONTEXTE & EXPORTS (4)
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
      properties: { ...PAGINATION_PROPERTIES },
    },
  },
  {
    name: 'pennylane_export_fec',
    description: 'Lancer la génération d\'un export FEC (Fichier des Écritures Comptables) sur une période. Obligatoire pour les contrôles fiscaux en France. La génération est asynchrone : ce tool renvoie un export_id, puis pennylane_get_fec_export fournit le lien de téléchargement une fois l\'export prêt. Nécessite le scope "ledger".',
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
    name: 'pennylane_get_fec_export',
    description: 'Récupérer l\'état d\'un export FEC lancé par pennylane_export_fec, et son URL de téléchargement une fois le statut passé à "ready". Le lien expire au bout de 30 minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        export_id: { type: 'string', description: 'ID de l\'export renvoyé par pennylane_export_fec' },
      },
      required: ['export_id'],
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
        // `/me` renvoie { user, company, scopes } : les champs de l'utilisateur
        // sont imbriques, pas a la racine.
        const me = await pennylane('/me');
        const fiscalYearsData = await pennylane('/fiscal_years');
        const fiscalYears = asArray(fiscalYearsData, 'fiscal_years');
        const txData = await pennylane('/transactions?limit=5');
        const transactions = asArray(txData, 'transactions');

        return {
          status: 'ok',
          timestamp: new Date().toISOString(),
          connection: {
            user: { email: me.user?.email, company: me.company?.name },
            scopes: me.scopes ?? [],
          },
          fiscalYears: {
            total: fiscalYears.length,
            current: findCurrentFiscalYear(fiscalYears),
          },
          recentActivity: {
            lastTransactions: transactions.length,
            lastTransactionDate: transactions[0]?.date,
          },
        };
      }
      
      case 'pennylane_list_customer_invoices': {
        return await listTool('/customer_invoices', args, {
          filters: dateFilters(args.start_date, args.end_date),
          itemKeys: ['invoices'],
        });
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
        return await listTool(`/customer_invoices/${args.invoice_id}/matched_transactions`, args, {
          itemKeys: ['matched_transactions'],
        });
      }
      
      case 'pennylane_list_supplier_invoices': {
        return await listTool('/supplier_invoices', args, {
          filters: dateFilters(args.start_date, args.end_date),
          itemKeys: ['invoices'],
        });
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
        return await listTool('/transactions', args, {
          filters: dateFilters(args.start_date, args.end_date),
          itemKeys: ['transactions'],
        });
      }
      
      case 'pennylane_list_bank_accounts': {
        return await listTool('/bank_accounts', args, { itemKeys: ['bank_accounts'] });
      }
      
      case 'pennylane_get_customers': {
        return await listTool('/customers', args, { itemKeys: ['customers'] });
      }
      
      case 'pennylane_get_suppliers': {
        return await listTool('/suppliers', args, { itemKeys: ['suppliers'] });
      }
      
      case 'pennylane_list_categories': {
        return await listTool('/categories', args, { itemKeys: ['categories'] });
      }
      
      case 'pennylane_list_ledger_entries': {
        return await listTool('/ledger_entries', args, {
          filters: dateFilters(args.start_date, args.end_date),
          itemKeys: ['ledger_entries'],
        });
      }
      
      case 'pennylane_list_products': {
        return await listTool('/products', args, { itemKeys: ['products'] });
      }
      
      case 'pennylane_list_journals': {
        return await listTool('/journals', args, { itemKeys: ['journals'] });
      }
      
      case 'pennylane_list_ledger_accounts': {
        return await listTool('/ledger_accounts', args, { itemKeys: ['ledger_accounts'] });
      }
      
      case 'pennylane_list_quotes': {
        return await listTool('/quotes', args, {
          filters: dateFilters(args.start_date, args.end_date),
          itemKeys: ['quotes'],
        });
      }
      
      case 'pennylane_get_user_context': {
        const me = await pennylane('/me');
        const fiscalYearsData = await pennylane('/fiscal_years');
        const fiscalYears = asArray(fiscalYearsData, 'fiscal_years');
        const user = me.user || {};
        const company = me.company || {};

        return {
          user: {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            locale: user.locale,
          },
          company: {
            id: company.id,
            name: company.name,
            // L'API expose `reg_no` (numero d'immatriculation), pas `siret`
            // ni `vat_number`.
            reg_no: company.reg_no,
          },
          // Scopes du token : indispensable pour comprendre pourquoi un tool
          // renvoie 403.
          scopes: me.scopes ?? [],
          fiscal_years: fiscalYears,
          current_fiscal_year: findCurrentFiscalYear(fiscalYears),
        };
      }
      
      case 'pennylane_list_fiscal_years': {
        return await listTool('/fiscal_years', args, { itemKeys: ['fiscal_years'] });
      }
      
      case 'pennylane_export_fec': {
        const { start_date, end_date } = args;
        // L'endpoint est `/exports/fecs` (pluriel) et attend `period_start` /
        // `period_end`. La generation est asynchrone : ce POST cree l'export,
        // le fichier se recupere ensuite via pennylane_get_fec_export.
        const data = await pennylane('/exports/fecs', {
          method: 'POST',
          body: { period_start: start_date, period_end: end_date },
        });
        return {
          period: { start_date, end_date },
          export_id: data.id,
          status: data.status,
          created_at: data.created_at,
          note: "Generation asynchrone : appelez pennylane_get_fec_export avec cet export_id jusqu'a ce que le statut passe a \"ready\" pour obtenir l'URL de telechargement.",
        };
      }

      case 'pennylane_get_fec_export': {
        const { export_id } = args;
        const data = await pennylane(`/exports/fecs/${export_id}`);
        return {
          export_id: data.id,
          status: data.status,
          // Le lien expire au bout de 30 minutes.
          file_url: data.file_url ?? null,
          ready: data.status === 'ready',
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
    {
      status: 401,
      // Avec OAuth, le defi pointe vers les metadonnees de ressource protegee :
      // c'est ainsi que Claude et ChatGPT decouvrent le serveur d'autorisation.
      headers: { 'WWW-Authenticate': oauth ? oauth.wwwAuthenticate() : 'Bearer realm="mcp-pennylane-owl"' },
    },
  );
}

export async function POST(request) {
  if (!(await isAuthorized(request))) {
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
          // JSON compact : l'indentation alourdissait les reponses de ~40 %
          // sans rien apporter au modele.
          content: [{ type: 'text', text: JSON.stringify(result) }],
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
  if (!(await isAuthorized(request))) {
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
