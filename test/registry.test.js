import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRegistry, missingOperations, serializeRegistry, simplifySchema } from '../scripts/registry.mjs';
import { LEVEL1_OPERATION_IDS } from '../lib/level1-operations.js';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const SPEC = JSON.parse(read('../openapi/accounting.json'));
const REGISTRY = JSON.parse(read('../lib/registry.json'));

// Spec minimale : une operation, parametres de chemin et de requete, corps.
function tinySpec(overrides = {}) {
  return {
    info: { version: '2.0' },
    paths: {
      '/api/external/v2/journals/{id}': {
        get: {
          operationId: 'getJournal',
          summary: 'Get a journal',
          security: [{ oauth2: ['journals:readonly', 'journals:all'] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
          responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } } },
        },
      },
      ...overrides,
    },
  };
}

describe('registre : fichier committe', () => {
  it('correspond exactement a la spec committee', () => {
    const rebuilt = serializeRegistry(buildRegistry(SPEC, { source: REGISTRY.source }));

    assert.equal(rebuilt, read('../lib/registry.json'), 'lancer : npm run registry');
  });

  it('contient toutes les operations du niveau 1', () => {
    assert.deepEqual(missingOperations(REGISTRY, LEVEL1_OPERATION_IDS), []);
  });

  it('decrit chaque operation de facon coherente', () => {
    const operations = Object.values(REGISTRY.operations);

    assert.equal(operations.length, REGISTRY.operation_count);
    for (const op of operations) {
      assert.match(op.method, /^(GET|POST|PUT|PATCH|DELETE)$/, op.operation_id);
      assert.ok(op.path.startsWith('/') && !op.path.startsWith('/api/external'), op.operation_id);
      // Chaque segment {x} du chemin est un parametre de chemin declare.
      for (const [, name] of op.path.matchAll(/\{([^}]+)\}/g)) {
        assert.ok(
          op.parameters.some(p => p.in === 'path' && p.name === name && p.required),
          `${op.operation_id} : parametre de chemin ${name} non declare`,
        );
      }
    }
  });
});

describe('registre : construction', () => {
  it('retire le prefixe de l API et met la methode en majuscules', () => {
    const registry = buildRegistry(tinySpec(), { source: 'test' });
    const op = registry.operations.getJournal;

    assert.equal(op.method, 'GET');
    assert.equal(op.path, '/journals/{id}');
    assert.deepEqual(op.scopes, ['journals:readonly', 'journals:all']);
    assert.equal(op.request_body, null);
    assert.equal(op.response.status, 200);
  });

  it('ecarte les exemples des schemas', () => {
    const registry = buildRegistry(tinySpec(), { source: 'test' });

    assert.equal(registry.operations.getJournal.parameters[0].schema.example, undefined);
  });

  it('detecte une operation du niveau 1 disparue de la spec', () => {
    const registry = buildRegistry(tinySpec(), { source: 'test' });

    assert.deepEqual(missingOperations(registry, ['getJournal', 'getJournals']), ['getJournals']);
  });

  it('refuse un operationId en double', () => {
    const duplicate = {
      '/api/external/v2/journals': { get: { operationId: 'getJournal', responses: {} } },
    };

    assert.throws(() => buildRegistry(tinySpec(duplicate), { source: 'test' }), /double/);
  });

  it('refuse un chemin hors du prefixe de l API', () => {
    const outside = { '/autre/journals': { get: { operationId: 'x', responses: {} } } };

    assert.throws(() => buildRegistry(tinySpec(outside), { source: 'test' }), /hors de/);
  });

  it('limite la profondeur des schemas de reponse', () => {
    const deep = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'string' } } } } } } };

    const simplified = simplifySchema(deep, 2);

    assert.equal(simplified.properties.a.properties.b.type, 'object');
    assert.equal(simplified.properties.a.properties.b.properties, undefined);
  });
});
