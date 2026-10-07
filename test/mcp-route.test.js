import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { importHmacKey, signJwt } from '../lib/oauth/crypto.js';

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
// respondWith peut renvoyer { [HTTP_STATUS]: 403, text } pour simuler un refus.
const HTTP_STATUS = Symbol('statut HTTP');

const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const body = respondWith(String(url), init);
    if (body === FAIL) {
      return { ok: false, status: 500, text: async () => 'erreur simulee' };
    }
    if (body?.[HTTP_STATUS]) {
      return { ok: false, status: body[HTTP_STATUS], text: async () => body.text };
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

// Configuration OAuth de test. Le stockage n'est pas sollicite par la
// verification d'un jeton d'acces, seul chemin exerce ici.
const OAUTH_ENV = {
  MCP_PUBLIC_URL: 'https://exemple.test/api/mcp',
  OAUTH_SIGNING_KEY: 'ab'.repeat(32),
  OAUTH_OWNER_PASSWORD: 'mot-de-passe-du-proprietaire-de-test',
  KV_REST_API_URL: 'https://kv.exemple.test',
  KV_REST_API_TOKEN: 'jeton-kv',
};

async function loadRoute({ mcpToken = MCP_TOKEN, pennylaneToken = 'faux-token-pennylane', oauth = false } = {}) {
  if (mcpToken === null) delete process.env.MCP_AUTH_TOKEN;
  else process.env.MCP_AUTH_TOKEN = mcpToken;

  if (pennylaneToken === null) delete process.env.PENNYLANE_API_TOKEN;
  else process.env.PENNYLANE_API_TOKEN = pennylaneToken;

  for (const [name, value] of Object.entries(OAUTH_ENV)) {
    if (oauth) process.env[name] = value;
    else delete process.env[name];
  }

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
  const text = body.result.content[0].text;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { result: body.result, payload, text };
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

describe('authentification OAuth', () => {
  // Jeton d'acces tel que l'emet le serveur d'autorisation.
  async function accessToken(overrides = {}) {
    const iat = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        iss: 'https://exemple.test',
        aud: OAUTH_ENV.MCP_PUBLIC_URL,
        sub: 'owner',
        scope: 'pennylane',
        iat,
        exp: iat + 3600,
        ...overrides,
      },
      await importHmacKey(OAUTH_ENV.OAUTH_SIGNING_KEY),
    );
  }

  const toolsList = headers => jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers);

  it('pointe le defi 401 vers les metadonnees de ressource protegee', async () => {
    const { POST } = await loadRoute({ oauth: true });
    const response = await POST(toolsList());

    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('www-authenticate'),
      'Bearer resource_metadata="https://exemple.test/.well-known/oauth-protected-resource", scope="pennylane"',
    );
  });

  it('accepte un jeton d acces emis pour cette ressource', async () => {
    const { POST } = await loadRoute({ oauth: true });
    const response = await POST(toolsList({ authorization: `Bearer ${await accessToken()}` }));

    assert.equal(response.status, 200);
  });

  it('refuse un jeton emis pour une autre ressource', async () => {
    const { POST } = await loadRoute({ oauth: true });
    const token = await accessToken({ aud: 'https://autre.exemple/api/mcp' });
    const response = await POST(toolsList({ authorization: `Bearer ${token}` }));

    assert.equal(response.status, 401);
  });

  it('refuse un jeton expire', async () => {
    const { POST } = await loadRoute({ oauth: true });
    const token = await accessToken({ exp: Math.floor(Date.now() / 1000) - 1 });
    const response = await POST(toolsList({ authorization: `Bearer ${token}` }));

    assert.equal(response.status, 401);
  });

  it('accepte toujours le secret partage en parallele', async () => {
    const { POST } = await loadRoute({ oauth: true });
    const response = await POST(toolsList(AUTH));

    assert.equal(response.status, 200);
  });

  it('accepte un jeton OAuth meme sans secret partage configure', async () => {
    const { POST } = await loadRoute({ oauth: true, mcpToken: null });

    assert.equal((await POST(toolsList({ authorization: 'Bearer ' }))).status, 401);
    assert.equal((await POST(toolsList({ authorization: `Bearer ${await accessToken()}` }))).status, 200);
  });

  it('refuse un jeton OAuth quand OAuth n est pas configure', async () => {
    const { POST } = await loadRoute();
    const response = await POST(toolsList({ authorization: `Bearer ${await accessToken()}` }));

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
  it('expose 45 tools aux noms uniques et prefixes', async () => {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, AUTH));
    const { result } = await response.json();
    const names = result.tools.map(tool => tool.name);

    assert.equal(result.tools.length, 45);
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

  it('gere un objet pagine pour fiscal_years dans resolve_fiscal_period', async () => {
    const { POST } = await loadRoute();
    respondWith = url => (url.includes('/fiscal_years') ? { items: [{ id: 7, status: 'open' }] } : {});

    const { payload } = await callTool(POST, 'pennylane_resolve_fiscal_period');

    assert.equal(payload.fiscal_year.id, 7);
  });

  it('gere un tableau brut', async () => {
    const { POST } = await loadRoute();
    respondWith = () => [{ id: 1 }, { id: 2 }];

    const { payload } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

    assert.equal(payload.count, 2);
  });

  // Forme reelle de toutes les listes, verifiee sur les fixtures d or.
  it('lit les elements sous items', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [{ id: 1 }], has_more: false, next_cursor: null });

    const { payload } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

    assert.equal(payload.count, 1);
  });

  it('renvoie une liste vide sur une forme inattendue, sans lever', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ forme: 'inattendue' });

    const { result, payload } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

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
    await callTool(POST, 'pennylane_list_journals', { limit: 5000, response_format: 'json' });

    assert.match(lastCallUrl(), /limit=100(&|$)/);
  });

  it('ramene un limit negatif ou nul a 1', async () => {
    const { POST } = await loadRoute();
    await callTool(POST, 'pennylane_list_journals', { limit: -3 });

    assert.match(lastCallUrl(), /limit=1(&|$)/);
  });

  it('refuse un limit non numerique, sans appeler l API', async () => {
    const { POST } = await loadRoute();
    const { result, payload } = await callTool(POST, 'pennylane_list_journals', { limit: 'beaucoup' });

    assert.equal(result.isError, true);
    assert.match(payload.message, /limit : number attendu/);
    assert.equal(calls.length, 0);
  });

  it('applique 50 par defaut', async () => {
    const { POST } = await loadRoute();
    await callTool(POST, 'pennylane_list_journals');

    assert.match(lastCallUrl(), /limit=50(&|$)/);
  });

  it('conserve une valeur valide', async () => {
    const { POST } = await loadRoute();
    await callTool(POST, 'pennylane_list_journals', { limit: 25 });

    assert.match(lastCallUrl(), /limit=25(&|$)/);
  });
});

describe('pagination par curseur', () => {
  // Outils de liste : ceux qui acceptent response_format. Les arguments
  // requis recoivent une valeur minimale selon leur schema.
  async function listTools() {
    const { POST } = await loadRoute();
    const response = await POST(jsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, AUTH));
    const { result } = await response.json();
    return result.tools
      .filter(tool => tool.inputSchema.properties.response_format)
      .map(tool => {
        const args = { response_format: 'json' };
        for (const name of tool.inputSchema.required ?? []) {
          const schema = tool.inputSchema.properties[name];
          args[name] = schema.format === 'date' ? '2026-01-01' : schema.type === 'integer' ? 42 : '42';
        }
        return { tool, args };
      });
  }

  // Deux pages chainees ; le curseur est lu dans l'URL appelee.
  const twoPages = url =>
    new URL(url).searchParams.get('cursor') === 'p2'
      ? { items: [{ id: 2 }], has_more: false, next_cursor: null }
      : { items: [{ id: 1 }], has_more: true, next_cursor: 'p2' };

  it('declare cursor et fetch_all sur chaque outil de liste pagine', async () => {
    const tools = await listTools();

    assert.equal(tools.length, 22);
    for (const { tool } of tools) {
      const properties = tool.inputSchema.properties;
      // Seule l'immatriculation PA n'est pas paginee par l'API.
      if (tool.name === 'pennylane_get_pa_registrations') {
        assert.equal(properties.cursor, undefined);
        continue;
      }
      assert.equal(properties.cursor?.type, 'string', `${tool.name}: cursor`);
      assert.equal(properties.fetch_all?.type, 'boolean', `${tool.name}: fetch_all`);
      assert.equal(properties.limit?.type, 'number', `${tool.name}: limit`);
    }
  });

  it('renvoie l enveloppe commune sur chaque outil de liste', async () => {
    for (const { tool, args } of await listTools()) {
      const { POST } = await loadRoute();
      // Lignes de balance valides pour la derivation du solde.
      respondWith = () => ({ items: [{ id: 1, debits: '1.0', credits: '0.0' }], has_more: true, next_cursor: 'suite' });

      const { result, payload } = await callTool(POST, tool.name, args);

      assert.equal(result.isError, false, `${tool.name} : ${JSON.stringify(payload)}`);
      assert.deepEqual(
        Object.keys(payload).sort(),
        ['count', 'has_more', 'items', 'next_cursor', 'truncated'],
        tool.name,
      );
      assert.equal(payload.count, 1, tool.name);
      assert.equal(payload.has_more, true, tool.name);
      assert.equal(payload.next_cursor, 'suite', tool.name);
      assert.equal(payload.truncated, false, tool.name);
    }
  });

  it('transmet le curseur et renvoie les filtres avec lui', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [] });

    await callTool(POST, 'pennylane_list_customer_invoices', {
      start_date: '2026-01-01',
      end_date: '2026-01-31',
      cursor: 'eyJpZCI6MTAwfQ==',
    });

    const params = new URL(lastCallUrl()).searchParams;
    assert.equal(params.get('cursor'), 'eyJpZCI6MTAwfQ==');
    assert.equal(JSON.parse(params.get('filter')).length, 2);
  });

  it('suit les pages avec fetch_all en renvoyant les filtres a chaque page', async () => {
    const { POST } = await loadRoute();
    respondWith = twoPages;

    const { payload } = await callTool(POST, 'pennylane_list_supplier_invoices', {
      start_date: '2026-01-01',
      fetch_all: true,
      response_format: 'json',
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(payload.items, [{ id: 1 }, { id: 2 }]);
    assert.equal(payload.has_more, false);
    assert.equal(payload.truncated, false);
    for (const call of calls) {
      assert.ok(new URL(call.url).searchParams.get('filter'), `filtre absent : ${call.url}`);
    }
  });

  it('ne lit qu une page sans fetch_all', async () => {
    const { POST } = await loadRoute();
    respondWith = twoPages;

    const { payload } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

    assert.equal(calls.length, 1);
    assert.equal(payload.has_more, true);
    assert.equal(payload.next_cursor, 'p2');
  });

  it('marque isError quand une page suivante echoue', async () => {
    const { POST } = await loadRoute();
    respondWith = url => (new URL(url).searchParams.get('cursor') === 'p2' ? FAIL : twoPages(url));

    const { result } = await callTool(POST, 'pennylane_list_journals', { fetch_all: true });

    assert.equal(result.isError, true);
  });
});

describe('remontee des erreurs', () => {
  it('marque isError sur une erreur de l API Pennylane', async () => {
    const { POST } = await loadRoute();
    respondWith = () => FAIL;

    const { result, payload } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

    assert.equal(result.isError, true);
    assert.equal(payload.error, true);
    assert.equal(payload.tool, 'pennylane_list_journals');
  });

  it('ne laisse pas fuiter le marqueur interne __mcpError', async () => {
    const { POST } = await loadRoute();
    respondWith = () => FAIL;

    const { result, payload } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

    assert.ok(!('__mcpError' in payload));
    assert.ok(!result.content[0].text.includes('__mcpError'));
  });

  it('marque isError sur un tool inconnu', async () => {
    const { POST } = await loadRoute();

    const { result } = await callTool(POST, 'pennylane_tool_inexistant');

    assert.equal(result.isError, true);
  });

  it('serialise le resultat en JSON compact', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [{ id: 1, label: 'a' }], has_more: false, next_cursor: null });

    const { result, payload } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

    assert.equal(result.content[0].text, JSON.stringify(payload));
  });

  it('n appelle pas l API et n est pas en erreur sur un appel nominal', async () => {
    const { POST } = await loadRoute();
    respondWith = () => ({ items: [{ id: 1 }] });

    const { result } = await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

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

    assert.equal(body.tools_count, 45);
    assert.equal(body.tools.length, 45);
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

    await callTool(POST, 'pennylane_list_journals', { response_format: 'json' });

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
    respondWith = () => ({ id: 124, status: 'pending', created_at: '2026-01-01T00:00:00Z' });

    await callTool(POST, 'pennylane_export_fec', {
      period_start: '2026-01-01',
      period_end: '2026-12-31',
    });

    assert.equal(calls.at(-1).method, 'POST');
  });
});

// Ces trois cas verrouillent des ecarts constates en confrontant le code au
// schema OpenAPI officiel de la Company API v2.
describe('conformite au schema OpenAPI Pennylane', () => {
  describe('/me renvoie { user, company, scopes }', () => {
    // Les champs de l'utilisateur sont imbriques sous `user`, pas a la racine.
    const ME = {
      user: { id: 12345, first_name: 'Jean', last_name: 'Martin', email: 'jean@exemple.test', locale: 'fr' },
      company: { id: 999, name: 'Entreprise Test', reg_no: '123456789' },
      scopes: ['customer_invoices', 'suppliers'],
    };

    it('health_check lit l email et la societe au bon niveau', async () => {
      const { POST } = await loadRoute();
      respondWith = url => (url.includes('/me') ? ME : { items: [] });

      const { payload } = await callTool(POST, 'pennylane_health_check');

      assert.equal(payload.connection.user.email, 'jean@exemple.test');
      assert.equal(payload.connection.user.company, 'Entreprise Test');
      assert.deepEqual(payload.connection.scopes, ['customer_invoices', 'suppliers']);
    });

    it('get_user_context lit l utilisateur imbrique', async () => {
      const { POST } = await loadRoute();
      respondWith = url => (url.includes('/me') ? ME : { items: [] });

      const { payload } = await callTool(POST, 'pennylane_get_user_context');

      assert.equal(payload.user.id, 12345);
      assert.equal(payload.user.email, 'jean@exemple.test');
      assert.equal(payload.user.first_name, 'Jean');
      assert.equal(payload.user.locale, 'fr');
    });

    it('get_user_context expose reg_no et non siret ou vat_number', async () => {
      const { POST } = await loadRoute();
      respondWith = url => (url.includes('/me') ? ME : { items: [] });

      const { payload } = await callTool(POST, 'pennylane_get_user_context');

      assert.equal(payload.company.reg_no, '123456789');
      assert.ok(!('siret' in payload.company));
      assert.ok(!('vat_number' in payload.company));
    });

    it('get_user_context expose les scopes du token', async () => {
      const { POST } = await loadRoute();
      respondWith = url => (url.includes('/me') ? ME : { items: [] });

      const { payload } = await callTool(POST, 'pennylane_get_user_context');

      assert.deepEqual(payload.scopes, ['customer_invoices', 'suppliers']);
    });
  });

  describe('exercice fiscal courant', () => {
    // Pennylane cree les exercices a venir a l'avance : plusieurs peuvent
    // etre ouverts en meme temps, et l'API les renvoie du plus recent au
    // plus ancien. Configuration reelle observee chez Owl Agency.
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const exercice = (offset, status) => ({
      id: year + offset,
      start: `${year + offset}-01-01`,
      finish: `${year + offset}-12-31`,
      status,
    });
    const PLUSIEURS_OUVERTS = {
      items: [exercice(2, 'open'), exercice(1, 'open'), exercice(0, 'open')],
    };

    it('retient l exercice qui contient la date du jour, pas le premier ouvert', async () => {
      const { POST } = await loadRoute();
      respondWith = url => (url.includes('/fiscal_years') ? PLUSIEURS_OUVERTS : { items: [] });

      const { payload } = await callTool(POST, 'pennylane_health_check');

      assert.equal(payload.fiscalYears.total, 3);
      assert.equal(payload.fiscalYears.current.id, year, 'doit designer l exercice en cours');
    });

    it('applique la meme logique dans resolve_fiscal_period', async () => {
      const { POST } = await loadRoute();
      respondWith = url => (url.includes('/fiscal_years') ? PLUSIEURS_OUVERTS : { items: [] });

      const { payload } = await callTool(POST, 'pennylane_resolve_fiscal_period', { fiscal_year: 'current' });

      assert.equal(payload.fiscal_year.id, year);
      assert.equal(payload.contains_today, true);
    });

    it('se rabat sur un exercice ouvert si aucun ne couvre aujourd hui', async () => {
      const { POST } = await loadRoute();
      respondWith = url =>
        url.includes('/fiscal_years') ? { items: [exercice(5, 'open')] } : { items: [] };

      const { payload } = await callTool(POST, 'pennylane_health_check');

      assert.equal(payload.fiscalYears.current.id, year + 5);
    });

    it('traite reopen comme un exercice ouvert dans le repli', async () => {
      const { POST } = await loadRoute();
      respondWith = url =>
        url.includes('/fiscal_years') ? { items: [exercice(5, 'reopen')] } : { items: [] };

      const { payload } = await callTool(POST, 'pennylane_health_check');

      assert.equal(payload.fiscalYears.current.id, year + 5);
    });

    it('ignore un exercice gele qui ne couvre pas aujourd hui', async () => {
      const { POST } = await loadRoute();
      respondWith = url =>
        url.includes('/fiscal_years')
          ? { items: [exercice(-2, 'frozen'), exercice(-1, 'closed')] }
          : { items: [] };

      const { payload } = await callTool(POST, 'pennylane_health_check');

      assert.equal(payload.fiscalYears.current, null);
    });
  });

  describe('export FEC', () => {
    const PERIOD = { period_start: '2026-01-01', period_end: '2026-12-31' };

    it('cible /exports/fecs au pluriel', async () => {
      const { POST } = await loadRoute();
      respondWith = () => ({ id: 124, status: 'pending' });

      await callTool(POST, 'pennylane_export_fec', PERIOD);

      assert.ok(lastCallUrl().endsWith('/exports/fecs'), lastCallUrl());
    });

    it('envoie period_start et period_end, les noms du schema', async () => {
      const { POST } = await loadRoute();
      respondWith = () => ({ id: 124, status: 'pending' });

      await callTool(POST, 'pennylane_export_fec', PERIOD);

      assert.deepEqual(calls.at(-1).body, PERIOD);
    });

    it('refuse start_date et end_date en citant les parametres attendus, sans appel', async () => {
      const { POST } = await loadRoute();

      const { result, payload } = await callTool(POST, 'pennylane_export_fec', {
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      });

      assert.equal(result.isError, true);
      assert.match(payload.message, /parametre inconnu start_date ; attendus : period_start, period_end/);
      assert.equal(calls.length, 0);
    });

    it('relaie l identifiant d export, la generation etant asynchrone', async () => {
      const { POST } = await loadRoute();
      respondWith = () => ({ id: 124, status: 'pending', created_at: '2026-01-01T10:00:00Z' });

      const { payload } = await callTool(POST, 'pennylane_export_fec', PERIOD);

      assert.deepEqual(payload, { id: 124, status: 'pending', created_at: '2026-01-01T10:00:00Z' });
    });

    it('recupere le fichier via get_fec_export une fois pret, lien intact', async () => {
      const { POST } = await loadRoute();
      respondWith = () => ({ id: 124, status: 'ready', file_url: 'https://exemple.test/fec.txt?signature=abc' });

      const { payload } = await callTool(POST, 'pennylane_get_fec_export', { id: 124 });

      assert.ok(lastCallUrl().endsWith('/exports/fecs/124'), lastCallUrl());
      assert.equal(payload.status, 'ready');
      assert.equal(payload.file_url, 'https://exemple.test/fec.txt?signature=abc');
    });

    it('signale un export encore en cours sans URL de fichier', async () => {
      const { POST } = await loadRoute();
      respondWith = () => ({ id: 124, status: 'pending', file_url: null });

      const { payload } = await callTool(POST, 'pennylane_get_fec_export', { id: 124 });

      assert.equal(payload.status, 'pending');
      assert.equal(payload.file_url, null);
    });
  });
});
