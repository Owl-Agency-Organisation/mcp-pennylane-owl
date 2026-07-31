import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ROUTE_URL = new URL('../app/api/mcp/route.js', import.meta.url).href;
const MCP_TOKEN = 'secret-mcp-token-de-test';
const AUTH = { authorization: `Bearer ${MCP_TOKEN}` };

// ============================================
// HARNESS
// ============================================

// Les appels sortants captures pendant le test courant.
let calls = [];
// Reponse renvoyee par le faux fetch. Recoit l'URL appelee pour permettre
// des reponses differentes selon l'endpoint. Renvoyer FAIL simule une
// erreur HTTP de l'API Pennylane.
let respondWith = () => ({});
const FAIL = Symbol('erreur API');

const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    const body = respondWith(String(url));
    if (body === FAIL) {
      return { ok: false, status: 500, text: async () => 'erreur simulee' };
    }
    return { ok: true, status: 200, json: async () => body };
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  respondWith = () => ({});
});

// Le module lit les variables d'environnement a l'import. Le parametre de
// requete casse le cache d'import pour obtenir une evaluation fraiche a
// chaque configuration testee.
let loadCounter = 0;
async function loadRoute({ mcpToken = MCP_TOKEN, pennylaneToken = 'faux-token-pennylane' } = {}) {
  if (mcpToken === null) delete process.env.MCP_AUTH_TOKEN;
  else process.env.MCP_AUTH_TOKEN = mcpToken;

  if (pennylaneToken === null) delete process.env.PENNYLANE_API_TOKEN;
  else process.env.PENNYLANE_API_TOKEN = pennylaneToken;

  process.env.PENNYLANE_API_BASE_URL = 'https://api.test/v2';

  return import(`${ROUTE_URL}?charge=${++loadCounter}`);
}

function jsonRpcRequest(body, headers = {}) {
  return new Request('https://exemple.test/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// Appelle un tool et renvoie { result, payload } ou payload est le JSON
// deserialise du bloc de contenu MCP.
async function callTool(POST, name, args) {
  const response = await POST(
    jsonRpcRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      AUTH,
    ),
  );
  const body = await response.json();
  return { result: body.result, payload: JSON.parse(body.result.content[0].text) };
}

const lastCallUrl = () => calls.at(-1).url;

// ============================================
// TESTS
// ============================================

describe('authentification', () => {
  it('refuse une requete sans token', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));

    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer/);
  });

  it('refuse un token invalide', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer mauvais' }),
    );

    assert.equal(response.status, 401);
  });

  it('refuse un prefixe de token valide', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      jsonRpcRequest(
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { authorization: `Bearer ${MCP_TOKEN.slice(0, -1)}` },
      ),
    );

    assert.equal(response.status, 401);
  });

  it('accepte Authorization: Bearer', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, AUTH));

    assert.equal(response.status, 200);
  });

  it('accepte X-MCP-Token pour les clients qui ne peuvent pas personnaliser Authorization', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'x-mcp-token': MCP_TOKEN }),
    );

    assert.equal(response.status, 200);
  });

  it('refuse tout quand MCP_AUTH_TOKEN n est pas configure (fail-closed)', async () => {
    const { POST } = await loadRoute({ mcpToken: null });
    const response = await POST(
      jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer ' }),
    );

    assert.equal(response.status, 401);
  });
});

describe('protocole MCP', () => {
  it('renvoie la revision de protocole demandee si elle est supportee', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      jsonRpcRequest(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
        AUTH,
      ),
    );
    const { result } = await response.json();

    assert.equal(result.protocolVersion, '2024-11-05');
    assert.equal(result.serverInfo.name, 'mcp-pennylane-owl');
  });

  it('retombe sur la revision la plus recente si celle demandee est inconnue', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      jsonRpcRequest(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
        AUTH,
      ),
    );
    const { result } = await response.json();

    assert.equal(result.protocolVersion, '2025-06-18');
  });

  it('ne renvoie aucun corps pour une notification', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, AUTH));

    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
  });

  it('rejette une enveloppe qui n est pas du JSON-RPC 2.0', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'tools/list' }, AUTH));
    const { error } = await response.json();

    assert.equal(error.code, -32600);
  });

  it('rejette une methode inconnue', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'inconnue/methode' }, AUTH));
    const { error } = await response.json();

    assert.equal(error.code, -32601);
  });

  it('rejette un tools/call sans nom de tool', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }, AUTH));
    const { error } = await response.json();

    assert.equal(error.code, -32602);
  });

  it('renvoie une erreur de parsing sur un corps illisible', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      new Request('https://exemple.test/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...AUTH },
        body: 'pas du json',
      }),
    );
    const { error } = await response.json();

    assert.equal(error.code, -32700);
  });
});

describe('catalogue de tools', () => {
  it('expose 21 tools aux noms uniques et prefixes', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, AUTH));
    const { result } = await response.json();
    const names = result.tools.map(tool => tool.name);

    assert.equal(result.tools.length, 21);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every(name => name.startsWith('pennylane_')));
  });

  it('declare un inputSchema exploitable pour chaque tool', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, AUTH));
    const { result } = await response.json();

    for (const tool of result.tools) {
      assert.equal(tool.inputSchema.type, 'object', `${tool.name}: inputSchema.type`);
      assert.ok(tool.description?.length > 0, `${tool.name}: description manquante`);
      for (const required of tool.inputSchema.required ?? []) {
        assert.ok(
          Object.hasOwn(tool.inputSchema.properties ?? {}, required),
          `${tool.name}: "${required}" est requis mais absent de properties`,
        );
      }
    }
  });
});

describe('normalisation des reponses Pennylane', () => {
  // L'API renvoie tantot un tableau brut, tantot un objet pagine. Avant
  // correctif, health_check et get_user_context appelaient .length et
  // .find() directement sur la reponse et plantaient sur la forme objet.
  it('gere un objet pagine pour fiscal_years dans health_check', async () => {
    const { POST } = await loadRoute();
    respondWith = url => {
      if (url.includes('/me')) return { email: 'compta@exemple.test', company: { name: 'Entreprise Test' } };
      if (url.includes('/fiscal_years')) return { items: [{ id: 7, status: 'open' }] };
      if (url.includes('/transactions')) return { items: [{ date: '2026-01-05' }] };
      return {};
    };

    const { result, payload } = await callTool(POST, 'pennylane_health_check');

    assert.equal(result.isError, false);
    assert.equal(payload.fiscalYears.total, 1);
    assert.equal(payload.fiscalYears.current.id, 7);
  });

  it('gere un objet pagine pour fiscal_years dans get_user_context', async () => {
    const { POST } = await loadRoute();
    respondWith = url => {
      if (url.includes('/me')) return { id: 1, email: 'compta@exemple.test', company: { name: 'Entreprise Test' } };
      if (url.includes('/fiscal_years')) return { items: [{ id: 7, status: 'open' }] };
      return {};
    };

    const { payload } = await callTool(POST, 'pennylane_get_user_context');

    assert.equal(payload.fiscal_years.length, 1);
    assert.equal(payload.current_fiscal_year.id, 7);
  });

  it('gere un tableau brut', async () => {
    const { POST } = await loadRoute();
    respondWith = () => [{ id: 1 }, { id: 2 }];

    const { payload } = await callTool(POST, 'pennylane_list_journals');

    assert.equal(payload.count, 2);
  });

  it('gere une cle nommee plutot que items', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ journals: [{ id: 1 }] });

    const { payload } = await callTool(POST, 'pennylane_list_journals');

    assert.equal(payload.count, 1);
  });

  it('renvoie une liste vide sur une forme inattendue, sans lever', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ forme: 'inattendue' });

    const { result, payload } = await callTool(POST, 'pennylane_list_journals');

    assert.equal(result.isError, false);
    assert.equal(payload.count, 0);
  });

  it('ne plante pas sur un exercice ouvert absent', async () => {
    const { POST } = await loadRoute();
    respondWith = url => {
      if (url.includes('/me')) return { email: 'compta@exemple.test' };
      if (url.includes('/fiscal_years')) return { items: [{ id: 3, status: 'closed' }] };
      return { items: [] };
    };

    const { result, payload } = await callTool(POST, 'pennylane_health_check');

    assert.equal(result.isError, false);
    assert.equal(payload.fiscalYears.current, null);
  });
});

describe('pagination', () => {
  beforeEach(() => {
    respondWith = () => ({ items: [] });
  });

  it('plafonne le limit a 100', async () => {
    const { POST } = await loadRoute();
    await callTool(POST, 'pennylane_list_journals', { limit: 5000 });

    assert.match(lastCallUrl(), /limit=100(&|$)/);
  });

  it('ramene un limit negatif ou nul a 1', async () => {
    const { POST } = await loadRoute();
    await callTool(POST, 'pennylane_list_journals', { limit: -3 });

    assert.match(lastCallUrl(), /limit=1(&|$)/);
  });

  it('retombe sur 50 pour un limit non numerique', async () => {
    const { POST } = await loadRoute();
    await callTool(POST, 'pennylane_list_journals', { limit: 'beaucoup' });

    assert.match(lastCallUrl(), /limit=50(&|$)/);
  });

  it('conserve une valeur valide', async () => {
    const { POST } = await loadRoute();
    await callTool(POST, 'pennylane_list_journals', { limit: 25 });

    assert.match(lastCallUrl(), /limit=25(&|$)/);
  });
});

describe('remontee des erreurs', () => {
  it('marque isError sur une erreur de l API Pennylane', async () => {
    const { POST } = await loadRoute();
    respondWith = () => FAIL;

    const { result, payload } = await callTool(POST, 'pennylane_list_journals');

    assert.equal(result.isError, true);
    assert.equal(payload.error, true);
    assert.equal(payload.tool, 'pennylane_list_journals');
  });

  it('ne laisse pas fuiter le marqueur interne __mcpError', async () => {
    const { POST } = await loadRoute();
    respondWith = () => FAIL;

    const { result, payload } = await callTool(POST, 'pennylane_list_journals');

    assert.ok(!('__mcpError' in payload));
    assert.ok(!result.content[0].text.includes('__mcpError'));
  });

  it('marque isError sur un tool inconnu', async () => {
    const { POST } = await loadRoute();

    const { result } = await callTool(POST, 'pennylane_tool_inexistant');

    assert.equal(result.isError, true);
  });

  it('n appelle pas l API et n est pas en erreur sur un appel nominal', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [{ id: 1 }] });

    const { result } = await callTool(POST, 'pennylane_list_journals');

    assert.equal(result.isError, false);
  });
});

describe('GET', () => {
  it('ne revele ni les tools ni la configuration sans token', async () => {
    const { GET } = await loadRoute();
    const body = await (await GET(new Request('https://exemple.test/api/mcp'))).json();

    assert.equal(body.status, 'running');
    assert.equal(body.tools, undefined);
    assert.equal(body.tools_count, undefined);
    assert.equal(body.api_version, undefined);
  });

  it('detaille le serveur avec un token valide', async () => {
    const { GET } = await loadRoute();
    const body = await (await GET(new Request('https://exemple.test/api/mcp', { headers: AUTH }))).json();

    assert.equal(body.tools_count, 21);
    assert.equal(body.tools.length, 21);
    assert.equal(body.pennylane_token_configured, true);
  });

  it('signale un token Pennylane manquant', async () => {
    const { GET } = await loadRoute({ pennylaneToken: null });
    const body = await (await GET(new Request('https://exemple.test/api/mcp', { headers: AUTH }))).json();

    assert.equal(body.pennylane_token_configured, false);
  });
});

describe('appels sortants vers Pennylane', () => {
  it('porte le token Pennylane et cible la base configuree', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [] });

    await callTool(POST, 'pennylane_list_journals');

    assert.ok(lastCallUrl().startsWith('https://api.test/v2/'), lastCallUrl());
    assert.equal(calls.length, 1);
  });

  it('encode les filtres de date au format attendu par l API', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [] });

    await callTool(POST, 'pennylane_list_customer_invoices', {
      start_date: '2026-01-01',
      end_date: '2026-01-31',
    });

    const filter = new URL(lastCallUrl()).searchParams.get('filter');
    assert.deepEqual(JSON.parse(filter), [
      { field: 'date', operator: 'gteq', value: '2026-01-01' },
      { field: 'date', operator: 'lteq', value: '2026-01-31' },
    ]);
  });

  it('omet le filtre quand aucune date n est fournie', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [] });

    await callTool(POST, 'pennylane_list_customer_invoices');

    assert.equal(new URL(lastCallUrl()).searchParams.get('filter'), null);
  });

  it('utilise POST pour l export FEC', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ download_url: 'https://exemple.test/fec.txt' });

    const { payload } = await callTool(POST, 'pennylane_export_fec', {
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });

    assert.equal(calls.at(-1).method, 'POST');
    assert.equal(payload.download_url, 'https://exemple.test/fec.txt');
  });
});
