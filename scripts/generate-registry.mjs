// Registre des operations : spec OpenAPI -> lib/registry.json.
//
//   node scripts/generate-registry.mjs            regenere le registre depuis la spec committee
//   node scripts/generate-registry.mjs --check    echoue si le registre committe n'est pas a jour
//   node scripts/generate-registry.mjs --refresh  telecharge la spec officielle, puis regenere
//
// La spec est committee (openapi/accounting.json) : le build ne lit jamais le
// reseau, et une mise a jour de la spec passe par une PR relisible. Dans tous
// les modes, le script echoue si une operation du niveau 1 manque : une
// rupture d'API casse le build au lieu de casser la production.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRegistry, missingOperations, serializeRegistry } from './registry.mjs';
import { LEVEL1_OPERATION_IDS } from '../lib/level1-operations.js';

export const SPEC_URL = 'https://pennylane.readme.io/openapi/accounting.json';
const SPEC_PATH = fileURLToPath(new URL('../openapi/accounting.json', import.meta.url));
const REGISTRY_PATH = fileURLToPath(new URL('../lib/registry.json', import.meta.url));

const mode = process.argv[2] ?? '--write';

function fail(message) {
  console.error(`registre : ${message}`);
  process.exit(1);
}

if (!['--write', '--check', '--refresh'].includes(mode)) {
  fail(`mode inconnu ${mode} (--check, --refresh ou rien)`);
}

if (mode === '--refresh') {
  const res = await fetch(SPEC_URL);
  if (!res.ok) fail(`telechargement de la spec : HTTP ${res.status}`);
  fs.writeFileSync(SPEC_PATH, await res.text());
  console.log(`registre : spec telechargee depuis ${SPEC_URL}`);
}

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const registry = buildRegistry(spec, { source: SPEC_URL });

const missing = missingOperations(registry, LEVEL1_OPERATION_IDS);
if (missing.length > 0) {
  fail(`operations du niveau 1 absentes de la spec : ${missing.join(', ')}`);
}

const serialized = serializeRegistry(registry);
if (mode === '--check') {
  const committed = fs.existsSync(REGISTRY_PATH) ? fs.readFileSync(REGISTRY_PATH, 'utf8') : '';
  if (committed !== serialized) {
    fail('lib/registry.json ne correspond pas a la spec committee. Lancer : npm run registry');
  }
  console.log(`registre : a jour, ${registry.operation_count} operations, niveau 1 present`);
} else {
  fs.writeFileSync(REGISTRY_PATH, serialized);
  console.log(`registre : ${registry.operation_count} operations ecrites dans lib/registry.json`);
}
