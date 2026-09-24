// Point unique des derivations : toute valeur que le serveur calcule, au lieu
// de la relayer telle que Pennylane la renvoie, vit ici, nommee et testee.
// Trois bugs sur quatre sont nes dans les deux seuls outils qui derivaient
// une valeur ; les outils, eux, restent des relais fins.

export class DerivationError extends Error {}

// Date du jour a Paris : les exercices sont des dates calendaires
// francaises. Le format en-CA donne YYYY-MM-DD.
export function parisDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

// Exercice qui contient la date ; a defaut, premier exercice ouvert
// (Pennylane cree les exercices a venir a l'avance et les renvoie du plus
// recent au plus ancien : le premier ouvert n'est donc pas le courant).
// Les dates sont au format YYYY-MM-DD : la comparaison lexicographique
// equivaut a la comparaison chronologique.
export function currentFiscalYear(fiscalYears, today) {
  const inRange = fiscalYears.find(f => f.start && f.finish && f.start <= today && today <= f.finish);
  if (inRange) return inRange;
  return fiscalYears.find(f => f.status === 'open' || f.status === 'reopen') || null;
}

const describeFiscalYear = f => `${f.id} (${f.start} → ${f.finish}, ${f.status})`;

// Interpretation d'exercice pour pennylane_resolve_fiscal_period :
// « current » ou un identifiant. Renvoie les bornes a reprendre telles quelles
// dans les filtres de date, et dit si l'exercice contient la date du jour.
export function resolveFiscalPeriod(fiscalYears, selector, today) {
  let fiscalYear;
  if (selector === 'current') {
    fiscalYear = currentFiscalYear(fiscalYears, today);
    if (!fiscalYear) {
      throw new DerivationError(
        `Aucun exercice ne contient le ${today} et aucun n'est ouvert. Exercices : ${fiscalYears.map(describeFiscalYear).join(' ; ') || 'aucun'}.`,
      );
    }
  } else {
    fiscalYear = fiscalYears.find(f => String(f.id) === String(selector));
    if (!fiscalYear) {
      throw new DerivationError(
        `Exercice ${selector} introuvable. Exercices : ${fiscalYears.map(describeFiscalYear).join(' ; ') || 'aucun'}.`,
      );
    }
  }
  return {
    fiscal_year: { id: fiscalYear.id, start: fiscalYear.start, finish: fiscalYear.finish, status: fiscalYear.status },
    today,
    contains_today: fiscalYear.start <= today && today <= fiscalYear.finish,
    filters: { start_date: fiscalYear.start, end_date: fiscalYear.finish },
  };
}

// Montant en centimes entiers, depuis la chaine decimale de l'API, sans
// jamais passer par un nombre flottant. Plus de deux decimales : erreur,
// jamais d'arrondi silencieux.
export function amountToCents(amount) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount ?? '').trim());
  if (!match) throw new DerivationError(`Montant illisible : ${JSON.stringify(amount)}`);
  const [, sign, units, decimals = ''] = match;
  const cents = BigInt(units) * 100n + BigInt(decimals.padEnd(2, '0') || '0');
  return sign === '-' ? -cents : cents;
}

export function formatCents(cents) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const units = absolute / 100n;
  const remainder = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${units}.${remainder}`;
}

// Solde d'une ligne de balance : debit moins credit, en centimes entiers.
// Jamais de total sur l'ensemble des lignes.
export function lineBalance(line) {
  return formatCents(amountToCents(line.debits) - amountToCents(line.credits));
}
