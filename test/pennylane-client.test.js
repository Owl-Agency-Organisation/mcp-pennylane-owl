import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPennylaneClient,
  MIN_INTERVAL_MS,
  MAX_RETRIES_ON_429,
} from '../lib/pennylane.js';

// Horloge simulee : `sleep` avance le temps sans attendre, et chaque attente
// est enregistree.
function fakeClock() {
  let t = 1_000_000;
  const sleeps = [];
  return {
    now: () => t,
    sleep: async ms => {
      sleeps.push(ms);
      t += ms;
    },
    advance: ms => {
      t += ms;
    },
    sleeps,
  };
}

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Client branche sur une file de reponses. Les appels sortants sont captures
// avec l'instant simule de leur emission.
function makeClient(responses) {
  const clock = fakeClock();
  const queue = [...responses];
  const calls = [];
  const request = createPennylaneClient({
    baseUrl: 'https://api.test/v2',
    token: 'token-de-test',
    fetch: async (url, init) => {
      calls.push({ url, init, at: clock.now() });
      return queue.shift();
    },
    sleep: clock.sleep,
    now: clock.now,
  });
  return { request, calls, clock };
}

const RATE_LIMITED = 'Rate limit exceeded. Please retry in 2 seconds.';

describe('client Pennylane : appels', () => {
  it('porte le token et cible la base configuree', async () => {
    const { request, calls } = makeClient([response(200, { items: [] })]);

    await request('/journals?limit=5');

    assert.equal(calls[0].url, 'https://api.test/v2/journals?limit=5');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-de-test');
    assert.equal(calls[0].init.method, 'GET');
  });

  it('serialise le corps d un POST', async () => {
    const { request, calls } = makeClient([response(201, { id: 1 })]);

    await request('/exports/fecs', { method: 'POST', body: { period_start: '2026-01-01' } });

    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, '{"period_start":"2026-01-01"}');
  });

  it('remonte une erreur HTTP avec son code et son corps, sans reprise', async () => {
    const { request, calls } = makeClient([response(500, 'panne')]);

    await assert.rejects(request('/journals'), /Pennylane API error 500: panne/);
    assert.equal(calls.length, 1);
  });
});

describe('client Pennylane : cadence', () => {
  it('espace deux appels consecutifs d au moins l intervalle minimal', async () => {
    const { request, calls } = makeClient([response(200), response(200)]);

    await request('/a');
    await request('/b');

    assert.ok(calls[1].at - calls[0].at >= MIN_INTERVAL_MS, `${calls[1].at - calls[0].at} ms`);
  });

  it('reste sous 5 requetes par seconde sur une rafale', async () => {
    const { request, calls } = makeClient(Array.from({ length: 10 }, () => response(200)));

    for (let i = 0; i < 10; i++) await request(`/p${i}`);

    // Toute fenetre d'une seconde contient au plus 4 appels.
    for (const call of calls) {
      const inWindow = calls.filter(c => c.at >= call.at && c.at < call.at + 1000).length;
      assert.ok(inWindow <= 4, `${inWindow} appels dans une fenetre d une seconde`);
    }
  });

  it('n attend pas quand l intervalle est deja ecoule', async () => {
    const { request, clock } = makeClient([response(200), response(200)]);

    await request('/a');
    clock.advance(MIN_INTERVAL_MS * 4);
    await request('/b');

    assert.deepEqual(clock.sleeps, []);
  });
});

describe('client Pennylane : reprise apres un 429', () => {
  it('attend le delai de retry-after puis reprend', async () => {
    const { request, calls, clock } = makeClient([
      response(429, RATE_LIMITED, { 'retry-after': '2' }),
      response(200, { id: 7 }),
    ]);

    const body = await request('/journals');

    assert.deepEqual(body, { id: 7 });
    assert.equal(calls.length, 2);
    assert.ok(clock.sleeps.includes(2000), `attentes : ${clock.sleeps}`);
    assert.ok(calls[1].at - calls[0].at >= 2000);
  });

  it('remonte le 429 apres le nombre maximal de reprises', async () => {
    const { request, calls } = makeClient(
      Array.from({ length: MAX_RETRIES_ON_429 + 2 }, () => response(429, RATE_LIMITED, { 'retry-after': '1' })),
    );

    await assert.rejects(request('/journals'), /Pennylane API error 429: Rate limit exceeded/);
    assert.equal(calls.length, MAX_RETRIES_ON_429 + 1);
  });

  it('ne reprend pas sans en-tete retry-after', async () => {
    const { request, calls, clock } = makeClient([response(429, RATE_LIMITED)]);

    await assert.rejects(request('/journals'), /Pennylane API error 429/);
    assert.equal(calls.length, 1);
    assert.deepEqual(clock.sleeps, []);
  });

  it('ne reprend pas quand le delai depasse ce qu une fonction peut attendre', async () => {
    const { request, calls } = makeClient([
      response(429, 'Rate limit exceeded. Please retry in 60 seconds.', { 'retry-after': '60' }),
    ]);

    await assert.rejects(request('/journals'), /retry in 60 seconds/);
    assert.equal(calls.length, 1);
  });
});
