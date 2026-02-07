// MCP Server Pennylane - Owl Agency

const TOKEN = process.env.PENNYLANE_API_TOKEN;
const BASE_URL = process.env.PENNYLANE_API_BASE_URL || 'https://app.pennylane.com/api/v2';

if (!TOKEN) {
  console.error('[Pennylane] Token manquant!');
}

// Pennylane API client
async function pennylane(endpoint) {
  console.log(`[Pennylane] ${endpoint}`);
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Pennylane error: ${res.status}`);
  return res.json();
}

// Tools MCP
const TOOLS = [
  {
    name: 'pennylane_health_check',
    description: 'Vérifier le statut global de la comptabilité Owl Agency',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

// Exécution tools
async function executeTool(name) {
  console.log(`[MCP] Tool: ${name}`);
  
  if (name === 'pennylane_health_check') {
    try {
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
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }
  
  throw new Error(`Unknown tool: ${name}`);
}

// Handler POST (MCP JSON-RPC)
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
      const { name } = params;
      try {
        const result = await executeTool(name);
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (error) {
        return Response.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: error.message },
        });
      }
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
    tools: TOOLS.map(t => t.name),
  });
}
