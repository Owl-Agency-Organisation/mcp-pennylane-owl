import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToCents,
  currentFiscalYear,
  DerivationError,
  formatCents,
  lineBalance,
  parisDate,
  resolveFiscalPeriod,
} from '../lib/derivations.js';

// Exercices reels (fixtures d'or) : trois ouverts, du plus recent au plus
// ancien, et un exercice long de 19 mois, gele.
const FISCAL_YEARS = [
  { id: 4, start: '2028-01-01', finish: '2028-12-31', status: 'open' },
  { id: 3, start: '2027-01-01', finish: '2027-12-31', status: 'open' },
  { id: 2, start: '2026-01-01', finish: '2026-12-31', status: 'open' },
  { id: 1, start: '2024-05-16', finish: '2025-12-31', status: 'frozen' },
];

describe('derivations : date du jour', () => {
  it('prend la date a Paris, pas en UTC', () => {
    // 31/12 a 23 h 30 UTC : deja le 1er janvier a Paris.
    assert.equal(parisDate(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
    assert.equal(parisDate(new Date('2026-06-15T12:00:00Z')), '2026-06-15');
  });
});

describe('derivations : exercice', () => {
  it('retient l exercice qui contient la date, pas le premier ouvert', () => {
    assert.equal(currentFiscalYear(FISCAL_YEARS, '2026-09-24').id, 2);
  });

  it('retient l exercice long, meme gele, quand il contient la date', () => {
    assert.equal(currentFiscalYear(FISCAL_YEARS, '2025-03-15').id, 1);
  });

  it('resout current en bornes reutilisables comme filtres', () => {
    const period = resolveFiscalPeriod(FISCAL_YEARS, 'current', '2025-03-15');

    assert.deepEqual(period.fiscal_year, { id: 1, start: '2024-05-16', finish: '2025-12-31', status: 'frozen' });
    assert.equal(period.contains_today, true);
    assert.deepEqual(period.filters, { start_date: '2024-05-16', end_date: '2025-12-31' });
  });

  it('resout un identifiant, en nombre ou en chaine', () => {
    assert.equal(resolveFiscalPeriod(FISCAL_YEARS, 3, '2026-09-24').fiscal_year.start, '2027-01-01');
    assert.equal(resolveFiscalPeriod(FISCAL_YEARS, '3', '2026-09-24').contains_today, false);
  });

  it('signale un repli : exercice ouvert qui ne contient pas la date', () => {
    const period = resolveFiscalPeriod([{ id: 9, start: '2030-01-01', finish: '2030-12-31', status: 'open' }], 'current', '2026-09-24');

    assert.equal(period.fiscal_year.id, 9);
    assert.equal(period.contains_today, false);
  });

  it('refuse un identifiant inconnu en listant les exercices', () => {
    assert.throws(
      () => resolveFiscalPeriod(FISCAL_YEARS, 99, '2026-09-24'),
      error => error instanceof DerivationError && /99 introuvable/.test(error.message) && /2024-05-16/.test(error.message),
    );
  });
});

describe('derivations : montants en centimes', () => {
  it('lit les formats de l API sans nombre flottant', () => {
    assert.equal(amountToCents('0.0'), 0n);
    assert.equal(amountToCents('1200.0'), 120000n);
    assert.equal(amountToCents('1234.5'), 123450n);
    assert.equal(amountToCents('1234.56'), 123456n);
    assert.equal(amountToCents('-0.1'), -10n);
  });

  it('reste exact la ou les flottants se trompent', () => {
    // 0.1 + 0.2 vaut 0.30000000000000004 en flottant.
    assert.equal(formatCents(amountToCents('0.1') + amountToCents('0.2')), '0.30');
  });

  it('refuse plus de deux decimales ou un format illisible, sans arrondir', () => {
    assert.throws(() => amountToCents('1.005'), DerivationError);
    assert.throws(() => amountToCents('1e3'), DerivationError);
    assert.throws(() => amountToCents(''), DerivationError);
    assert.throws(() => amountToCents(null), DerivationError);
  });

  it('formate les centimes avec deux decimales et le signe', () => {
    assert.equal(formatCents(0n), '0.00');
    assert.equal(formatCents(5n), '0.05');
    assert.equal(formatCents(-123456n), '-1234.56');
  });

  it('calcule le solde d une ligne : debit moins credit', () => {
    assert.equal(lineBalance({ debits: '1234.5', credits: '0.1' }), '1234.40');
    assert.equal(lineBalance({ debits: '0.0', credits: '38962.0' }), '-38962.00');
  });
});
