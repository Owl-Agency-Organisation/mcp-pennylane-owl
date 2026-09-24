import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginate, FETCH_ALL_MAX_PAGES } from '../lib/pagination.js';

// Fausse API : `count` pages chainees par curseur (c1, c2, ...), une
// ligne par page. Les curseurs recus sont enregistres.
function chainedPages(count) {
  const seen = [];
  const fetchPage = async cursor => {
    seen.push(cursor);
    const index = cursor ? Number(cursor.slice(1)) : 0;
    const last = index === count - 1;
    return { items: [{ page: index }], has_more: !last, next_cursor: last ? null : `c${index + 1}` };
  };
  return { fetchPage, seen };
}

const ENVELOPE_KEYS = ['count', 'has_more', 'items', 'next_cursor', 'truncated'];

describe('pagination : une page', () => {
  it('lit une seule page et remonte has_more et next_cursor tels quels', async () => {
    const { fetchPage, seen } = chainedPages(3);

    const envelope = await paginate(fetchPage);

    assert.deepEqual(Object.keys(envelope).sort(), ENVELOPE_KEYS);
    assert.deepEqual(envelope.items, [{ page: 0 }]);
    assert.equal(envelope.count, 1);
    assert.equal(envelope.has_more, true);
    assert.equal(envelope.next_cursor, 'c1');
    assert.equal(envelope.truncated, false);
    assert.deepEqual(seen, [null]);
  });

  it('transmet le curseur fourni', async () => {
    const { fetchPage, seen } = chainedPages(3);

    const envelope = await paginate(fetchPage, { cursor: 'c2' });

    assert.deepEqual(seen, ['c2']);
    assert.equal(envelope.has_more, false);
    assert.equal(envelope.next_cursor, null);
  });

  it('compte les elements renvoyes, jamais un total annonce', async () => {
    const envelope = await paginate(async () => ({
      items: [{ id: 1 }, { id: 2 }],
      total_items: 999,
      has_more: true,
      next_cursor: 'x',
    }));

    assert.equal(envelope.count, 2);
    assert.ok(!('total_items' in envelope));
  });

  it('ne presume pas la fin de liste quand l API ne dit rien', async () => {
    const envelope = await paginate(async () => [{ id: 1 }]);

    assert.equal(envelope.has_more, null);
    assert.equal(envelope.next_cursor, null);
    assert.equal(envelope.count, 1);
  });

  it('normalise une cle nommee plutot que items', async () => {
    const envelope = await paginate(async () => ({ journals: [{ id: 1 }] }), { itemKeys: ['journals'] });

    assert.equal(envelope.count, 1);
  });
});

describe('pagination : fetch_all', () => {
  it('suit les curseurs jusqu a la fin', async () => {
    const { fetchPage, seen } = chainedPages(3);

    const envelope = await paginate(fetchPage, { fetchAll: true });

    assert.deepEqual(envelope.items, [{ page: 0 }, { page: 1 }, { page: 2 }]);
    assert.equal(envelope.count, 3);
    assert.equal(envelope.has_more, false);
    assert.equal(envelope.next_cursor, null);
    assert.equal(envelope.truncated, false);
    assert.equal(envelope.message, undefined);
    assert.deepEqual(seen, [null, 'c1', 'c2']);
  });

  it('s arrete au plafond de pages et le signale', async () => {
    const { fetchPage, seen } = chainedPages(FETCH_ALL_MAX_PAGES + 5);

    const envelope = await paginate(fetchPage, { fetchAll: true });

    assert.equal(seen.length, FETCH_ALL_MAX_PAGES);
    assert.equal(envelope.count, FETCH_ALL_MAX_PAGES);
    assert.equal(envelope.has_more, true);
    assert.equal(envelope.next_cursor, `c${FETCH_ALL_MAX_PAGES}`);
    assert.equal(envelope.truncated, true);
    assert.match(envelope.message, /incomplète/);
    assert.match(envelope.message, /next_cursor/);
  });

  it('s arrete au budget de temps et le signale', async () => {
    const { fetchPage: inner, seen } = chainedPages(10);
    let t = 0;
    // Chaque page coute 10 s simulees.
    const fetchPage = async cursor => {
      t += 10_000;
      return inner(cursor);
    };

    const envelope = await paginate(fetchPage, { fetchAll: true, timeBudgetMs: 25_000, now: () => t });

    assert.equal(seen.length, 3);
    assert.equal(envelope.truncated, true);
    assert.equal(envelope.next_cursor, 'c3');
  });

  it('s arrete quand l API annonce la suite sans curseur', async () => {
    let calls = 0;
    const envelope = await paginate(
      async () => {
        calls++;
        return { items: [{ id: 1 }], has_more: true, next_cursor: null };
      },
      { fetchAll: true },
    );

    assert.equal(calls, 1);
    assert.equal(envelope.truncated, true);
    assert.match(envelope.message, /sans fournir de curseur/);
  });

  it('ecarte la page qui ferait depasser le plafond de taille, et reprend a son curseur', async () => {
    const { fetchPage, seen } = chainedPages(5);
    // Une page vaut 12 caracteres ([{"page":0}]) : deux pages tiennent dans 30.
    const envelope = await paginate(fetchPage, { fetchAll: true, maxChars: 30 });

    assert.deepEqual(seen, [null, 'c1', 'c2']);
    assert.deepEqual(envelope.items, [{ page: 0 }, { page: 1 }]);
    assert.ok(JSON.stringify(envelope.items).length <= 30);
    assert.equal(envelope.has_more, true);
    assert.equal(envelope.next_cursor, 'c2', 'la page ecartee doit etre relue a la reprise');
    assert.equal(envelope.truncated, true);
    assert.match(envelope.message, /pennylane_get_trial_balance/);
    assert.match(envelope.message, /FEC/);
    assert.match(envelope.message, /filtres/);
  });

  it('rend toujours la premiere page, meme au-dela du plafond de taille', async () => {
    const { fetchPage, seen } = chainedPages(3);

    const envelope = await paginate(fetchPage, { fetchAll: true, maxChars: 5 });

    assert.deepEqual(seen, [null, 'c1']);
    assert.deepEqual(envelope.items, [{ page: 0 }]);
    assert.equal(envelope.next_cursor, 'c1');
    assert.equal(envelope.truncated, true);
  });

  it('n applique pas le plafond de taille sans fetch_all', async () => {
    const { fetchPage } = chainedPages(3);

    const envelope = await paginate(fetchPage, { maxChars: 5 });

    assert.equal(envelope.count, 1);
    assert.equal(envelope.truncated, false);
    assert.equal(envelope.message, undefined);
  });

  it('reprend depuis un curseur fourni', async () => {
    const { fetchPage, seen } = chainedPages(4);

    const envelope = await paginate(fetchPage, { cursor: 'c2', fetchAll: true });

    assert.deepEqual(seen, ['c2', 'c3']);
    assert.equal(envelope.count, 2);
    assert.equal(envelope.truncated, false);
  });
});
