// Anonymisation des fixtures d'or, a partir de captures reelles de l'API.
//
//   node scripts/anonymize-fixtures.mjs <dossier-brut> <dossier-sortie> [noms-propres...]
//
// <dossier-brut> contient me.json, fiscal_years.json, journals.json et
// trial_balance.json, reponses brutes de l'API. Il reste hors du depot et se
// supprime des la sortie produite. Les noms propres (tiers, banque) cites en
// argument sont remplaces par « Banque » dans les libelles : ils ne sont
// jamais versionnes, et la liste se revoit a chaque capture.
//
// Garde : forme, types, ordre, enums, scopes verbatim, dates d'exercice,
// numeros et libelles du plan comptable, format des montants (pas leurs
// valeurs).
// Remplace : identites, identifiants, montants, curseurs, noms propres cites.
// Controle final : aucune valeur sensible du brut ne subsiste, sinon rien
// n'est ecrit.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [rawDir, outDir, ...properNouns] = process.argv.slice(2);
if (!rawDir || !outDir) {
  console.error('Usage : node scripts/anonymize-fixtures.mjs <dossier-brut> <dossier-sortie> [noms-propres...]');
  process.exit(2);
}
const read = name => JSON.parse(fs.readFileSync(path.join(rawDir, `${name}.json`), 'utf8'));

// Valeurs sensibles du brut, verifiees absentes de la sortie.
const sensitive = new Set();
const mark = value => {
  if (value !== null && value !== undefined && String(value).length >= 3) sensitive.add(String(value));
  return value;
};

// Identifiants fictifs qui gardent l'ordre relatif (tri par defaut : -id).
function fakeIds(items, base) {
  const sorted = [...items].map(item => item.id).sort((a, b) => a - b);
  return id => base + sorted.indexOf(mark(id)) + 1;
}

// Montant fictif : fonction du seul numero de compte et du champ, jamais du
// montant reel. Aucune transformation du montant reel n'intervient (ni
// coefficient, ni rien d'inversible), zeros compris. Seul le format de l'API
// est conserve : chaine decimale, une decimale au moins, zeros de fin retires.
// La fixture en couvre les quatre variantes : 0.0, N.0, N.D et N.DD.
function fakeAmount(seed) {
  const h = createHash('sha256').update(`fixture:${seed}`).digest();
  const euros = 1 + (h.readUInt32BE(1) % 99_999);
  switch (h[0] % 4) {
    case 0: return '0.0';
    case 1: return `${euros}.0`;
    case 2: return `${euros}.${1 + (h[5] % 9)}`;
    default: return `${euros}.${h[6] % 10}${1 + (h[7] % 9)}`;
  }
}

// Le montant reel n'est lu que pour verifier qu'il ne fuit pas.
const markAmount = value => (Number(value) === 0 ? value : mark(value));

function scrubNouns(text) {
  let out = text;
  for (const noun of properNouns) {
    mark(noun);
    out = out.replaceAll(noun, 'Banque');
  }
  return out;
}

const me = read('me');
const anonMe = {
  user: {
    id: (mark(me.user.id), 100001),
    first_name: (mark(me.user.first_name), 'Prénom'),
    last_name: (mark(me.user.last_name), 'Nom'),
    email: (mark(me.user.email), 'proprietaire@exemple.test'),
    locale: me.user.locale,
  },
  company: {
    id: (mark(me.company.id), 200001),
    name: (mark(me.company.name), 'Entreprise Exemple'),
    reg_no: (mark(me.company.reg_no), '000000000'),
    accounting_logic: me.company.accounting_logic,
  },
  scopes: me.scopes,
};

const fiscalYears = read('fiscal_years');
const fyId = fakeIds(fiscalYears.items, 300000);
const anonFiscalYears = {
  ...fiscalYears,
  items: fiscalYears.items.map(fy => ({ ...fy, id: fyId(fy.id) })),
};

const journals = read('journals');
const journalId = fakeIds(journals.items, 400000);
const anonJournals = {
  ...journals,
  items: journals.items.map(j => ({ ...j, id: journalId(j.id), label: scrubNouns(j.label) })),
};

const trialBalance = read('trial_balance');
const anonTrialBalance = {
  ...trialBalance,
  items: trialBalance.items.map(line => ({
    ...line,
    credits: (markAmount(line.credits), fakeAmount(`${line.number}:credits`)),
    debits: (markAmount(line.debits), fakeAmount(`${line.number}:debits`)),
    label: scrubNouns(line.label),
  })),
  next_cursor: trialBalance.next_cursor
    ? (mark(trialBalance.next_cursor), Buffer.from('curseur-fictif').toString('base64'))
    : trialBalance.next_cursor,
};

const outputs = {
  me: anonMe,
  fiscal_years: anonFiscalYears,
  journals: anonJournals,
  trial_balance: anonTrialBalance,
};

const leaks = [];
for (const [name, data] of Object.entries(outputs)) {
  const text = JSON.stringify(data);
  for (const value of sensitive) {
    if (text.includes(value)) leaks.push(`${name} : une valeur sensible subsiste (${value.length} caracteres)`);
  }
}
if (leaks.length > 0) {
  console.error(leaks.join('\n'));
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const [name, data] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`${Object.keys(outputs).length} fixtures anonymisees, ${sensitive.size} valeurs sensibles controlees absentes.`);
