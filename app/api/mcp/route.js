// Serveur MCP Pennylane sur la Company API v2. Les outils vivent dans
// lib/tools/ ; ce fichier porte le protocole et l'authentification.
// Endpoint JSON-RPC unique, compatible avec tout client MCP parlant HTTP.
// https://github.com/Owl-Agency-Organisation/mcp-pennylane-owl

import { createPennylaneClient } from '../../../lib/pennylane.js';
import { oauthFromEnv } from '../../../lib/oauth/env.js';
import { createToolbox } from '../../../lib/tools/index.js';

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

// Cadence les appels sous la limite de debit et reprend apres un 429.
const pennylane = createPennylaneClient({ baseUrl: BASE_URL, token: TOKEN });
const toolbox = createToolbox({ pennylane });

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
        result: { tools: toolbox.definitions },
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

      const { text, isError } = await toolbox.call(name, params.arguments || {});

      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
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
    tools_count: toolbox.definitions.length,
    tools: toolbox.definitions.map(t => t.name),
  });
}
