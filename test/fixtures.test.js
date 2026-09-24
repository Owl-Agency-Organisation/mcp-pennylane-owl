// Rejeu des outils contre les fixtures d'or : reponses reelles de l'API,
// anonymisees par scripts/anonymize-fixtures.mjs. Un test qui passait sur une
// fixture inventee et echoue ici revele un bug, pas un test a ajuster.

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture = name =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/pennylane/${name}.json`, import.meta.url), 'utf8'));

const FIXTURES = {
  '/me': fixture('me'),
  '/fiscal_years': fixture('fiscal_years'),
  '/journals': fixture('journals'),
  '/transactions': { items: [], has_more: false, next_cursor: null },
};

const ROUTE_URL = new URL('../app/api/mcp/route.js', import.meta.url).href;
const realFetch = globalThis.fetch;
let loadCounter = 0;

before(() => {
  globalThis.fetch = async url => {
    const body = FIXTURES[new URL(url).pathname.replace(/^\/v2/, '')];
    if (!body) throw new Error(`aucune fixture pour ${url}`);
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

async function callTool(name, args = {}) {
  process.env.MCP_AUTH_TOKEN = 'secret-de-rejeu';
  process.env.PENNYLANE_API_TOKEN = 'faux-token';
  process.env.PENNYLANE_API_BASE_URL = 'https://api.test/v2';
  const { POST } = await import(`${ROUTE_URL}?fixtures=${++loadCounter}`);
  const response = await POST(new Request('https://exemple.test/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret-de-rejeu' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const { result } = await response.json();
  return { result, payload: JSON.parse(result.content[0].text) };
}

// Les exercices dependent de la date du jour : elle est figee pour que le
// rejeu reste valable dans le temps.
function atDate(isoDate) {
  before(() => mock.timers.enable({ apis: ['Date'], now: new Date(`${isoDate}T12:00:00Z`) }));
  after(() => mock.timers.reset());
}

describe('fixtures d or : /me', () => {
  const ME = FIXTURES['/me'];

  it('health_check lit l email, la societe et les scopes au bon niveau', async () => {
    const { result, payload } = await callTool('pennylane_health_check');

    assert.equal(result.isError, false);
    assert.equal(payload.connection.user.email, ME.user.email);
    assert.equal(payload.connection.user.company, ME.company.name);
    assert.deepEqual(payload.connection.scopes, ME.scopes);
  });

  it('get_user_context lit l utilisateur imbrique et reg_no', async () => {
    const { payload } = await callTool('pennylane_get_user_context');

    assert.equal(payload.user.id, ME.user.id);
    assert.equal(payload.user.first_name, ME.user.first_name);
    assert.equal(payload.user.locale, ME.user.locale);
    assert.equal(payload.company.reg_no, ME.company.reg_no);
    assert.ok(!('siret' in payload.company));
    assert.ok(!('vat_number' in payload.company));
  });
});

describe('fixtures d or : exercice courant, en cours d annee civile', () => {
  // Trois exercices ouverts (2026, 2027, 2028), renvoyes du plus recent au
  // plus ancien : le premier ouvert n'est pas le courant.
  atDate('2026-09-24');

  it('designe l exercice qui contient la date, pas le premier ouvert', async () => {
    const { payload } = await callTool('pennylane_health_check');

    assert.equal(payload.fiscalYears.current.start, '2026-01-01');
    assert.equal(payload.fiscalYears.current.finish, '2026-12-31');
  });
});

describe('fixtures d or : exercice courant, exercice long et gele', () => {
  // Exercice de 19 mois (16/05/2024 -> 31/12/2025), au statut frozen.
  atDate('2025-03-15');

  it('designe l exercice long qui contient la date, meme gele', async () => {
    const { payload } = await callTool('pennylane_get_user_context');

    assert.equal(payload.current_fiscal_year.start, '2024-05-16');
    assert.equal(payload.current_fiscal_year.finish, '2025-12-31');
    assert.equal(payload.current_fiscal_year.status, 'frozen');
  });
});

describe('fixtures d or : listes', () => {
  it('list_fiscal_years remonte l enveloppe et la pagination telles quelles', async () => {
    const { payload } = await callTool('pennylane_list_fiscal_years');
    const raw = FIXTURES['/fiscal_years'];

    assert.equal(payload.count, raw.items.length);
    assert.equal(payload.has_more, raw.has_more);
    assert.equal(payload.next_cursor, raw.next_cursor);
    assert.equal(payload.truncated, false);
  });

  it('list_journals remonte les 11 journaux dans l ordre de l API', async () => {
    const { payload } = await callTool('pennylane_list_journals');

    assert.deepEqual(payload.items.map(j => j.code), FIXTURES['/journals'].items.map(j => j.code));
  });
});
