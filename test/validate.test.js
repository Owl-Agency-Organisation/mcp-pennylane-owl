import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../lib/validate.js';

const CATEGORY = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    direction: {
      anyOf: [
        { type: 'string', enum: ['cash_in', 'cash_out'] },
        { type: 'string', enum: [null], nullable: true },
      ],
    },
    category_group_id: { type: 'integer' },
    analytical_code: { type: 'string', nullable: true },
  },
  required: ['label', 'category_group_id'],
  additionalProperties: false,
};

describe('validation', () => {
  it('accepte un objet conforme', () => {
    assert.deepEqual(validate({ label: 'Projet A', category_group_id: 3 }, CATEGORY), []);
  });

  it('refuse un parametre inconnu en citant les parametres attendus', () => {
    const [error] = validate({ label: 'A', category_group_id: 3, libelle: 'x' }, CATEGORY);

    assert.match(error, /parametre inconnu libelle ; attendus : label, direction, category_group_id, analytical_code/);
  });

  it('signale les parametres requis manquants', () => {
    assert.deepEqual(validate({}, CATEGORY), ['label requis', 'category_group_id requis']);
  });

  it('controle types et valeurs admises', () => {
    assert.match(validate({ label: 'A', category_group_id: '3' }, CATEGORY)[0], /integer attendu, string recu/);
    assert.ok(validate({ label: 'A', category_group_id: 3, direction: 'sideways' }, CATEGORY).length > 0);
  });

  it('accepte null quand une branche ou le schema l autorise', () => {
    assert.deepEqual(validate({ label: 'A', category_group_id: 3, direction: null, analytical_code: null }, CATEGORY), []);
    assert.match(validate({ label: null, category_group_id: 3 }, CATEGORY)[0], /null non accepte/);
  });

  it('controle les formats de date', () => {
    assert.deepEqual(validate('2026-09-24', { type: 'string', format: 'date' }), []);
    assert.equal(validate('24/09/2026', { type: 'string', format: 'date' }).length, 1);
    assert.deepEqual(validate('2026-09-24T09:05:04.643705Z', { type: 'string', format: 'date-time' }), []);
    assert.equal(validate('2026-09-24', { type: 'string', format: 'date-time' }).length, 1);
  });

  it('descend dans les objets et les tableaux en nommant le chemin', () => {
    const schema = {
      type: 'object',
      properties: { lines: { type: 'array', items: { type: 'object', properties: { quantity: { type: 'number' } } } } },
    };

    assert.match(validate({ lines: [{ quantity: 'deux' }] }, schema)[0], /^lines\[0\]\.quantity : number attendu/);
  });

  it('laisse passer les proprietes additionnelles quand le schema les autorise', () => {
    assert.deepEqual(validate({ libre: 1 }, { type: 'object', properties: {}, additionalProperties: true }), []);
  });
});
