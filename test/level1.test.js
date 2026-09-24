// Contrats des outils de niveau 1 : construits sur le registre, relais fins,
// validation avant tout appel.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ROUTE_URL = new URL('../app/api/mcp/route.js', import.meta.url).href;
const realFetch = globalThis.fetch;

let calls = [];
// Reponse du faux Pennylane, selon l'URL. { status, text } simule un refus.
let respondWith = () => ({ items: [], has_more: false, next_cursor: null });
let loadCounter = 0;

before(() => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    const answer = respondWith(new URL(String(url)));
    if (answer?.status) return { ok: false, status: answer.status, text: async () => answer.text };
    return { ok: true, status: 200, json: async () => structuredClone(answer) };
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  respondWith = () => ({ items: [], has_more: false, next_cursor: null });
});

async function route() {
  process.env.MCP_AUTH_TOKEN = 'secret-niveau-1';
  process.env.PENNYLANE_API_TOKEN = 'faux';
  process.env.PENNYLANE_API_BASE_URL = 'https://api.test/v2';
  return import(`${ROUTE_URL}?niveau1=${++loadCounter}`);
}

async function rpc(method, params) {
  const { POST } = await route();
  const response = await POST(new Request('https://exemple.test/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret-niveau-1' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  return (await response.json()).result;
}

async function callTool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = result.content[0].text;
  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Markdown.
  }
  return { isError: result.isError, payload, text };
}

async function toolsByName() {
  const { tools } = await rpc('tools/list', {});
  return new Map(tools.map(tool => [tool.name, tool]));
}

describe('niveau 1 : catalogue', () => {
  it('porte des annotations derivees du verbe HTTP', async () => {
    const tools = await toolsByName();

    for (const tool of tools.values()) {
      assert.equal(tool.annotations.openWorldHint, true, tool.name);
      assert.equal(tool.annotations.destructiveHint, false, tool.name);
    }
    assert.equal(tools.get('pennylane_list_journals').annotations.readOnlyHint, true);
    assert.equal(tools.get('pennylane_create_category').annotations.readOnlyHint, false);
    assert.equal(tools.get('pennylane_create_category').annotations.idempotentHint, false);
    assert.equal(tools.get('pennylane_update_category').annotations.idempotentHint, true);
  });

  it('retire les outils qui totalisaient une page, et list_products', async () => {
    const tools = await toolsByName();

    for (const removed of ['pennylane_analyze_customer_invoices', 'pennylane_analyze_supplier_invoices', 'pennylane_list_products']) {
      assert.equal(tools.has(removed), false, removed);
    }
  });

  it('n offre pas de filtre de date sur les devis : l API le refuse', async () => {
    const quotes = (await toolsByName()).get('pennylane_list_quotes');

    assert.equal(quotes.inputSchema.properties.start_date, undefined);
    assert.equal(quotes.inputSchema.properties.end_date, undefined);
  });

  it('invite a resoudre l exercice avant les listes filtrables par date', async () => {
    const tools = await toolsByName();

    for (const tool of tools.values()) {
      if (tool.inputSchema.properties.start_date?.format === 'date' && tool.inputSchema.properties.end_date) {
        assert.match(tool.description, /pennylane_resolve_fiscal_period/, tool.name);
      }
    }
  });
});

describe('niveau 1 : validation avant appel', () => {
  it('refuse une date mal formee sans appeler l API', async () => {
    const { isError, payload } = await callTool('pennylane_list_transactions', { start_date: '24/09/2026' });

    assert.equal(isError, true);
    assert.match(payload.message, /start_date : date YYYY-MM-DD attendue/);
    assert.equal(calls.length, 0);
  });

  it('refuse un identifiant qui n est pas un entier : rien n est injecte dans le chemin', async () => {
    const { isError } = await callTool('pennylane_get_customer_invoice', { id: '1/../../me' });

    assert.equal(isError, true);
    assert.equal(calls.length, 0);
  });

  it('encode l identifiant dans le chemin', async () => {
    respondWith = () => ({ id: 'abc def' });

    await callTool('pennylane_update_category', { id: 'abc def', label: 'Projet B' });

    assert.equal(calls[0].url.pathname, '/v2/categories/abc%20def');
  });
});

describe('niveau 1 : ecritures', () => {
  it('cree une categorie avec le corps valide, sans l identifiant de chemin', async () => {
    respondWith = () => ({ id: 7, label: 'Projet A' });

    const { isError } = await callTool('pennylane_create_category', { label: 'Projet A', category_group_id: 3 });

    assert.equal(isError, false);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url.pathname, '/v2/categories');
    assert.deepEqual(calls[0].body, { label: 'Projet A', category_group_id: 3 });
  });

  it('refuse une categorie sans libelle, sans appel', async () => {
    const { isError, payload } = await callTool('pennylane_create_category', { category_group_id: 3 });

    assert.equal(isError, true);
    assert.match(payload.message, /label requis/);
    assert.equal(calls.length, 0);
  });

  it('modifie une categorie en PUT sur son identifiant', async () => {
    respondWith = () => ({ id: '12' });

    await callTool('pennylane_update_category', { id: '12', label: 'Projet B' });

    assert.equal(calls[0].method, 'PUT');
    assert.deepEqual(calls[0].body, { label: 'Projet B' });
  });

  it('valide le corps d un devis contre le registre avant l appel', async () => {
    const { isError, payload } = await callTool('pennylane_create_quote', { body: { champ_inconnu: 1 } });

    assert.equal(isError, true);
    assert.match(payload.message, /parametre inconnu champ_inconnu/);
    assert.equal(calls.length, 0);
  });
});

describe('niveau 1 : balance generale', () => {
  const PERIOD = { period_start: '2024-05-16', period_end: '2025-12-31', response_format: 'json' };

  it('ajoute le solde de chaque ligne, calcule en centimes, sans aucun total', async () => {
    respondWith = () => ({
      items: [
        { number: '401', debits: '1234.5', credits: '0.1' },
        { number: '1013', debits: '0.0', credits: '38962.0' },
      ],
      has_more: false,
      next_cursor: null,
    });

    const { payload } = await callTool('pennylane_get_trial_balance', PERIOD);

    assert.deepEqual(payload.items.map(line => line.balance), ['1234.40', '-38962.00']);
    assert.deepEqual(Object.keys(payload).sort(), ['count', 'has_more', 'items', 'next_cursor', 'truncated']);
  });

  it('renvoie la periode a chaque page', async () => {
    respondWith = url => (url.searchParams.get('cursor')
      ? { items: [{ debits: '1.0', credits: '0.0' }], has_more: false, next_cursor: null }
      : { items: [{ debits: '2.0', credits: '0.0' }], has_more: true, next_cursor: 'p2' });

    await callTool('pennylane_get_trial_balance', { ...PERIOD, fetch_all: true });

    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.url.searchParams.get('period_start'), '2024-05-16');
      assert.equal(call.url.searchParams.get('period_end'), '2025-12-31');
    }
  });

  it('echoue plutot que d arrondir un montant illisible', async () => {
    respondWith = () => ({ items: [{ debits: '1.005', credits: '0.0' }], has_more: false, next_cursor: null });

    const { isError, payload } = await callTool('pennylane_get_trial_balance', PERIOD);

    assert.equal(isError, true);
    assert.match(payload.message, /Montant illisible/);
  });

  it('exige la periode', async () => {
    const { isError, payload } = await callTool('pennylane_get_trial_balance', {});

    assert.equal(isError, true);
    assert.match(payload.message, /period_start requis/);
  });
});

describe('niveau 1 : historique des modifications', () => {
  it('refuse start_date avec cursor, sans appel', async () => {
    const { isError, payload } = await callTool('pennylane_list_changelog_transactions', {
      start_date: '2026-09-01T00:00:00Z',
      cursor: 'abc',
    });

    assert.equal(isError, true);
    assert.match(payload.message, /start_date ne se combine pas avec cursor/);
    assert.equal(calls.length, 0);
  });

  it('n envoie start_date qu a la premiere page', async () => {
    respondWith = url => (url.searchParams.get('cursor')
      ? { items: [{ id: 2 }], has_more: false, next_cursor: null }
      : { items: [{ id: 1 }], has_more: true, next_cursor: 'p2' });

    await callTool('pennylane_list_changelog_ledger_entry_lines', {
      start_date: '2026-09-01T00:00:00Z',
      fetch_all: true,
    });

    assert.equal(calls[0].url.searchParams.get('start_date'), '2026-09-01T00:00:00Z');
    assert.equal(calls[1].url.searchParams.get('start_date'), null);
    assert.equal(calls[1].url.searchParams.get('cursor'), 'p2');
  });
});

describe('niveau 1 : format des listes', () => {
  it('rend du markdown par defaut, champs vides omis', async () => {
    respondWith = () => ({
      items: [{ id: 1, label: 'Journal de vente', code: 'VT', archived_at: null, tags: [] }],
      has_more: false,
      next_cursor: null,
    });

    const { text } = await callTool('pennylane_list_journals');

    assert.match(text, /^count: 1 · has_more: false · next_cursor: null · truncated: false/);
    assert.match(text, /1\. id: 1 · label: Journal de vente · code: VT$/m);
    assert.ok(!text.includes('archived_at'));
  });
});

describe('niveau 1 : erreurs actionnables', () => {
  it('cite les scopes reels du token sur un 403', async () => {
    respondWith = url => (url.pathname.endsWith('/me')
      ? { scopes: ['journals:readonly', 'transactions:readonly'] }
      : { status: 403, text: 'Access to this resource requires scope "exports:gl"' });

    const { isError, payload } = await callTool('pennylane_export_general_ledger', {
      period_start: '2026-01-01',
      period_end: '2026-06-30',
    });

    assert.equal(isError, true);
    assert.match(payload.message, /Scopes réels du token : journals:readonly, transactions:readonly/);
  });

  it('oriente vers la recherche d operations sur un 404', async () => {
    respondWith = () => ({ status: 404, text: 'Not found' });

    const { payload } = await callTool('pennylane_get_quote', { id: 9999 });

    assert.match(payload.message, /pennylane_search_operations/);
  });
});
