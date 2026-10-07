// Garde-fous metier sur les ecritures : factures clients en brouillon
// uniquement, quel que soit le niveau qui appelle.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getOperation } from '../lib/operations.js';
import { enforceWriteGuards, GuardError } from '../lib/write-guards.js';

const ROUTE_URL = new URL('../app/api/mcp/route.js', import.meta.url).href;
const realFetch = globalThis.fetch;

let calls = [];
let respondWith = () => ({});
let loadCounter = 0;

before(() => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(String(url)), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true, status: 200, json: async () => structuredClone(respondWith(new URL(String(url)), init?.method || 'GET')) };
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
  process.env.MCP_AUTH_TOKEN = 'secret-garde-fous';
  process.env.PENNYLANE_API_TOKEN = 'faux';
  process.env.PENNYLANE_API_BASE_URL = 'https://api.test/v2';
  const { POST } = await import(`${ROUTE_URL}?gardefous=${++loadCounter}`);
  const response = await POST(new Request('https://exemple.test/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret-garde-fous' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const { result } = await response.json();
  return { isError: result.isError, payload: JSON.parse(result.content[0].text) };
}

const LINE = { label: 'Accompagnement', raw_currency_unit_price: '900', unit: 'jour', vat_rate: 'FR_200', quantity: 2 };
const INVOICE = { date: '2026-10-07', deadline: '2026-11-06', customer_id: 12, invoice_lines: [LINE] };

describe('garde-fou : creation de facture', () => {
  it('cree une facture en brouillon', async () => {
    respondWith = () => ({ id: 501, draft: true });

    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'postCustomerInvoices',
      body: { ...INVOICE, draft: true },
    });

    assert.equal(isError, false, JSON.stringify(payload));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url.pathname, '/v2/customer_invoices');
    assert.equal(calls[0].body.draft, true);
  });

  it('refuse une facture finalisee, sans appel', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'postCustomerInvoices',
      body: { ...INVOICE, draft: false },
    });

    assert.equal(isError, true);
    assert.match(payload.message, /brouillon/);
    assert.equal(calls.length, 0);
  });

  it('refuse une facture sans draft, que l API finaliserait, sans appel', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'postCustomerInvoices',
      body: INVOICE,
    });

    assert.equal(isError, true);
    assert.match(payload.message, /draft: true requis/);
    assert.equal(calls.length, 0);
  });

  it('refuse une facture finalisee depuis un devis, sans appel', async () => {
    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'createCustomerInvoiceFromQuote',
      body: { quote_id: 9, draft: false },
    });

    assert.equal(isError, true);
    assert.equal(calls.length, 0);
  });

  it('cree un brouillon depuis un devis', async () => {
    respondWith = () => ({ id: 502, draft: true });

    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'createCustomerInvoiceFromQuote',
      body: { quote_id: 9, draft: true },
    });

    assert.equal(isError, false);
    assert.equal(calls[0].url.pathname, '/v2/customer_invoices/create_from_quote');
  });
});

describe('garde-fou : modification et suppression de facture', () => {
  it('modifie un brouillon apres l avoir relu', async () => {
    respondWith = (url, method) => (method === 'GET' ? { id: 7, draft: true, status: 'draft' } : { id: 7 });

    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'updateCustomerInvoice',
      path_params: { id: 7 },
      body: { label: 'Nouveau libellé' },
    });

    assert.equal(isError, false, JSON.stringify(payload));
    assert.deepEqual(calls.map(c => `${c.method} ${c.url.pathname}`), ['GET /v2/customer_invoices/7', 'PUT /v2/customer_invoices/7']);
  });

  it('refuse de modifier une facture finalisee, sans ecriture', async () => {
    respondWith = () => ({ id: 7, draft: false, status: 'upcoming', invoice_number: 'F-2026-012' });

    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'updateCustomerInvoice',
      path_params: { id: 7 },
      body: { label: 'Nouveau libellé' },
    });

    assert.equal(isError, true);
    assert.match(payload.message, /n'est pas un brouillon/);
    assert.match(payload.message, /F-2026-012/);
    assert.match(payload.message, /avoir/);
    assert.deepEqual(calls.map(c => c.method), ['GET']);
  });

  it('supprime un brouillon apres l avoir relu', async () => {
    respondWith = (url, method) => (method === 'GET' ? { id: 8, draft: true } : {});

    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'deleteCustomerInvoices',
      path_params: { id: 8 },
    });

    assert.equal(isError, false);
    assert.deepEqual(calls.map(c => `${c.method} ${c.url.pathname}`), ['GET /v2/customer_invoices/8', 'DELETE /v2/customer_invoices/8']);
  });

  it('refuse de supprimer une facture finalisee, sans suppression', async () => {
    respondWith = () => ({ id: 8, draft: false, status: 'paid' });

    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'deleteCustomerInvoices',
      path_params: { id: 8 },
    });

    assert.equal(isError, true);
    assert.deepEqual(calls.map(c => c.method), ['GET']);
  });

  it('valide les parametres avant de relire la facture', async () => {
    const { isError, payload } = await callTool('pennylane_call_operation', {
      operation_id: 'deleteCustomerInvoices',
      path_params: {},
    });

    assert.equal(isError, true);
    assert.match(payload.message, /id requis/);
    assert.equal(calls.length, 0);
  });
});

describe('garde-fou : autres ecritures', () => {
  it('change le statut d un devis', async () => {
    respondWith = () => ({ id: 9, status: 'accepted' });

    const { isError } = await callTool('pennylane_call_operation', {
      operation_id: 'updateStatusQuote',
      path_params: { id: 9 },
      body: { status: 'accepted' },
    });

    assert.equal(isError, false);
    assert.deepEqual(calls.map(c => `${c.method} ${c.url.pathname}`), ['PUT /v2/quotes/9/update_status']);
  });

  it('refuse finalisation et envois, sans appel', async () => {
    for (const operation_id of ['finalizeCustomerInvoice', 'sendByEmailCustomerInvoice', 'sendToPaCustomerInvoice', 'sendByEmailQuote']) {
      const { isError, payload } = await callTool('pennylane_call_operation', { operation_id, path_params: { id: 1 } });

      assert.equal(isError, true, operation_id);
      assert.match(payload.message, /hors de la liste blanche/, operation_id);
    }
    assert.equal(calls.length, 0);
  });

  it('laisse passer les ecritures non concernees sans lecture prealable', async () => {
    const readInvoice = async () => assert.fail('aucune lecture attendue');

    await enforceWriteGuards(getOperation('postQuotes'), { body: {} }, { readInvoice });
    await enforceWriteGuards(getOperation('postCompanyCustomer'), { body: {} }, { readInvoice });
  });

  it('rejette par une GuardError', async () => {
    await assert.rejects(
      enforceWriteGuards(getOperation('postCustomerInvoices'), { body: { draft: false } }, { readInvoice: async () => ({}) }),
      GuardError,
    );
  });
});
