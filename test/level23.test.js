// Niveaux 2 et 3 : recherche, description et appel d'operations du registre.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY } from '../lib/operations.js';
import { WRITE_OPERATION_IDS } from '../lib/tools/write-whitelist.js';

const ROUTE_URL = new URL('../app/api/mcp/route.js', import.meta.url).href;
const realFetch = globalThis.fetch;

let calls = [];
let respondWith = () => ({});
let loadCounter = 0;

before(() => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true, status: 200, json: async () => structuredClone(respondWith(new URL(String(url)))) };
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  respondWith = () => ({});
});

async function callTool(name, args = {}) {
  process.env.MCP_AUTH_TOKEN = 'secret-niveaux-2-3';
  process.env.PENNYLANE_API_TOKEN = 'faux';
  process.env.PENNYLANE_API_BASE_URL = 'https://api.test/v2';
  const { POST } = await import(`${ROUTE_URL}?niveaux23=${++loadCounter}`);
  const response = await POST(new Request('https://exemple.test/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret-niveaux-2-3' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const { result } = await response.json();
  return { isError: result.isError, payload: JSON.parse(result.content[0].text) };
}

describe('liste blanche d ecriture', () => {
  it('ne contient que des ecritures existantes du registre', () => {
    for (const id of WRITE_OPERATION_IDS) {
      const operation = REGISTRY.operations[id];
      assert.ok(operation, `${id} absente du registre`);
      assert.notEqual(operation.method, 'GET', id);
    }
  });

  it('exclut en toutes circonstances transactions, ecritures comptables, suppressions et webhooks', () => {
    for (const id of WRITE_OPERATION_IDS) {
      const { path, method } = REGISTRY.operations[id];
      assert.ok(!/^\/(transactions|ledger_entries|ledger_entry_lines|webhook_subscriptions)\b/.test(path), `${id} : ${path}`);
      assert.notEqual(method, 'DELETE', id);
    }
  });
});

describe('niveau 2 : recherche', () => {
  it('trouve une operation depuis des mots-cles francais', async () => {
    const { payload } = await callTool('pennylane_search_operations', { query: 'factures fournisseurs' });

    assert.ok(payload.some(op => op.operation_id === 'getSupplierInvoices'), JSON.stringify(payload.map(op => op.operation_id)));
  });

  it('renvoie de quoi choisir, sans les schemas', async () => {
    const { payload } = await callTool('pennylane_search_operations', { query: 'mandate', limit: 3 });

    assert.ok(payload.length > 0 && payload.length <= 3);
    assert.deepEqual(Object.keys(payload[0]).sort(), ['method', 'operation_id', 'path', 'scopes', 'summary']);
  });

  it('ne propose jamais les abonnements webhook', async () => {
    const { payload } = await callTool('pennylane_search_operations', { query: 'webhook subscriptions', limit: 25 });

    assert.ok(payload.every(op => !op.path.startsWith('/webhook_subscriptions')));
  });

  it('n appelle jamais l API', async () => {
    await callTool('pennylane_search_operations', { query: 'invoice' });

    assert.equal(calls.length, 0);
  });
});

describe('niveau 3 : description', () => {
  it('decrit une lecture et la declare appelable', async () => {
    const { payload } = await callTool('pennylane_describe_operation', { operation_id: 'getCustomerInvoice' });

    assert.equal(payload.method, 'GET');
    assert.equal(payload.path, '/customer_invoices/{id}');
    assert.ok(payload.parameters.some(p => p.name === 'id' && p.in === 'path'));
    assert.equal(payload.callable, true);
  });

  it('declare une ecriture hors liste blanche non appelable', async () => {
    const { payload } = await callTool('pennylane_describe_operation', { operation_id: 'createTransaction' });

    assert.equal(payload.callable, false);
    assert.match(payload.reason, /hors de la liste blanche/);
  });

  it('signale l envoi de fichier comme non pris en charge', async () => {
    const { payload } = await callTool('pennylane_describe_operation', { operation_id: 'postFileAttachments' });

    assert.equal(payload.callable, false);
    assert.match(payload.reason, /multipart\/form-data/);
  });

  it('oriente vers la recherche pour une operation inconnue', async () => {
    const { isError, payload } = await callTool('pennylane_describe_operation', { operation_id: 'getNimporteQuoi' });

    assert.equal(isError, true);
    assert.match(payload.message, /pennylane_search_operations/);
  });

  it('refuse de decrire un abonnement webhook', async () => {
    const { isError, payload } = await callTool('pennylane_describe_operation', { operation_id: 'getWebhookSubscriptions' });

    assert.equal(isError, true);
    assert.match(payload.message, /webhook/);
  });
});

describe('niveau 3 : appel', () => {
  it('appelle une lecture avec parametres de chemin et de requete valides', async () => {
    respondWith = () => ({ items: [], has_more: false, next_cursor: null });

    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'getSupplierInvoiceMatchedTransactions',
      path_params: { supplier_invoice_id: 42 },
      query: { limit: 10 },
    });

    assert.equal(isError, false);
    assert.equal(calls[0].url.pathname, '/v2/supplier_invoices/42/matched_transactions');
    assert.equal(calls[0].url.searchParams.get('limit'), '10');
  });

  it('refuse un parametre de requete inconnu en citant les attendus, sans appel', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'getJournals',
      query: { page: 2 },
    });

    assert.equal(isError, true);
    assert.match(payload.message, /parametre de requete inconnu page ; attendus : cursor, limit, filter, sort/);
    assert.equal(calls.length, 0);
  });

  it('refuse un parametre de chemin manquant, sans appel', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', { operation_id: 'getQuote' });

    assert.equal(isError, true);
    assert.match(payload.message, /id requis/);
    assert.equal(calls.length, 0);
  });

  it('refuse un type de parametre incorrect, sans appel', async () => {
    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'getJournals',
      query: { limit: 'cent' },
    });

    assert.equal(isError, true);
    assert.equal(calls.length, 0);
  });

  it('refuse une ecriture sur les transactions ou les ecritures comptables, sans appel', async () => {
    for (const operation_id of ['createTransaction', 'postLedgerEntries', 'putLedgerEntries']) {
      const { isError, payload } = await callTool('pennylane_call_operation', { operation_id, body: {} });

      assert.equal(isError, true, operation_id);
      assert.match(payload.message, /hors de la liste blanche/, operation_id);
    }
    assert.equal(calls.length, 0);
  });

  it('refuse toute suppression, sans appel', async () => {
    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'deleteCustomerInvoices',
      path_params: { id: 1 },
    });

    assert.equal(isError, true);
    assert.equal(calls.length, 0);
  });

  it('refuse les webhooks, meme en lecture', async () => {
    const { isError } = await callTool('pennylane_call_operation', { operation_id: 'getWebhookSubscriptions' });

    assert.equal(isError, true);
    assert.equal(calls.length, 0);
  });

  it('refuse l envoi de fichier tant que le mecanisme n est pas arbitre', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', { operation_id: 'postFileAttachments', body: {} });

    assert.equal(isError, true);
    assert.match(payload.message, /envoi de fichier/);
    assert.equal(calls.length, 0);
  });

  it('execute une ecriture de la liste blanche avec un corps valide', async () => {
    respondWith = () => ({ id: 77, name: 'Prospect SAS' });

    const body = {
      name: 'Prospect SAS',
      billing_address: { address: '1 rue Exemple', postal_code: '75001', city: 'Paris', country_alpha2: 'FR' },
    };
    const { isError, payload } = await callTool('pennylane_call_operation', { operation_id: 'postCompanyCustomer', body });

    assert.equal(isError, false, JSON.stringify(payload));
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url.pathname, '/v2/company_customers');
    assert.deepEqual(calls[0].body, body);
    assert.deepEqual(payload, { id: 77, name: 'Prospect SAS' });
  });

  it('refuse un client sans adresse de facturation, requise par le schema', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'postCompanyCustomer',
      body: { name: 'Prospect SAS' },
    });

    assert.equal(isError, true);
    assert.match(payload.message, /billing_address requis/);
    assert.equal(calls.length, 0);
  });

  it('refuse un corps invalide pour une ecriture autorisee, sans appel', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'postCategories',
      body: { libelle: 'Projet' },
    });

    assert.equal(isError, true);
    assert.match(payload.message, /label requis/);
    assert.match(payload.message, /parametre inconnu libelle/);
    assert.equal(calls.length, 0);
  });
});
