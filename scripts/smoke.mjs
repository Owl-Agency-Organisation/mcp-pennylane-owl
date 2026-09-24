// Test smoke : demarre le serveur de production, puis verifie initialize,
// tools/list et un health_check contre le vrai Pennylane.
//
// Prerequis : `npm run build`, et PENNYLANE_API_TOKEN dans l'environnement ou
// dans .env.local (charge par Next.js au demarrage). Le secret MCP est genere
// pour la duree du test : le secret de production n'est jamais necessaire.
//
// Les journaux de CI d'un depot public sont publics : ce script n'affiche ni
// email, ni nom de societe, ni scopes, et ne montre la sortie du serveur
// qu'en cas d'echec.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

// Nombre d'outils attendu. A mettre a jour a chaque changement delibere du
// catalogue : un outil perdu ou ajoute par erreur fait echouer le smoke.
const EXPECTED_TOOL_COUNT = 42;

// Budget de poids de tools/list. Faute de tokenizer sans dependance, on
// estime 3 caracteres par token : plus severe que le ratio usuel de 4, pour
// ne jamais sous-estimer le poids reel.
const TOOLS_LIST_TOKEN_BUDGET = 15_000;
const CHARS_PER_TOKEN = 3;

const PROTOCOL_VERSION = '2025-06-18';
const STARTUP_TIMEOUT_MS = 60_000;
const SERVER_OUTPUT_MAX = 20_000;

const NEXT_BIN = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Les exercices sont des dates calendaires francaises : la date du jour est
// prise a Paris, pas en UTC. Le format en-CA donne YYYY-MM-DD.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(port, mcpToken) {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, MCP_AUTH_TOKEN: mcpToken },
    // Groupe de processus dedie : l'arret tue aussi les enfants de Next.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = chunk => {
    output = (output + chunk).slice(-SERVER_OUTPUT_MAX);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return { child, output: () => output };
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([exited, sleep(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`le serveur s'est arrete au demarrage (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/mcp`);
      if (res.ok) return;
    } catch {
      // Pas encore a l'ecoute.
    }
    await sleep(250);
  }
  throw new Error(`le serveur n'a pas repondu en ${STARTUP_TIMEOUT_MS / 1000} s`);
}

function makeRpc(baseUrl, mcpToken) {
  let id = 0;
  return async (method, params) => {
    const res = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${mcpToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    assert.equal(res.status, 200, `${method} : HTTP ${res.status}`);
    const body = await res.json();
    assert.equal(body.error, undefined, `${method} : erreur JSON-RPC ${JSON.stringify(body.error)}`);
    return body.result;
  };
}

async function checkInitialize(rpc) {
  const result = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1' },
  });
  assert.equal(result.serverInfo?.name, 'mcp-pennylane-owl', 'initialize : serverInfo.name inattendu');
  assert.equal(result.protocolVersion, PROTOCOL_VERSION, 'initialize : revision du protocole non negociee');
  console.log(`ok - initialize : ${result.serverInfo.name} ${result.serverInfo.version}, protocole ${result.protocolVersion}`);
}

async function checkToolsList(rpc) {
  const { tools } = await rpc('tools/list', {});
  const names = tools.map(t => t.name);

  const duplicates = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  assert.deepEqual(duplicates, [], `tools/list : noms dupliques ${duplicates.join(', ')}`);
  assert.equal(names.length, EXPECTED_TOOL_COUNT, `tools/list : ${names.length} outils, ${EXPECTED_TOOL_COUNT} attendus`);

  const chars = JSON.stringify(tools).length;
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
  assert.ok(
    tokens <= TOOLS_LIST_TOKEN_BUDGET,
    `tools/list : ~${tokens} tokens estimes, budget ${TOOLS_LIST_TOKEN_BUDGET}`,
  );
  console.log(`ok - tools/list : ${names.length} outils, aucun doublon, ~${tokens} tokens estimes (${chars} caracteres, budget ${TOOLS_LIST_TOKEN_BUDGET})`);
}

async function checkHealth(rpc) {
  const result = await rpc('tools/call', { name: 'pennylane_health_check', arguments: {} });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(result.isError, false, `health_check : erreur remontee par l'outil : ${payload.message}`);

  // Assertions de sens, pas de forme.
  const current = payload.fiscalYears?.current;
  assert.ok(current, 'health_check : aucun exercice courant designe');
  assert.ok(
    current.start <= today && today <= current.finish,
    `health_check : l'exercice courant ${current.start} → ${current.finish} ne contient pas le ${today}`,
  );
  console.log(`ok - health_check : exercice courant ${current.start} → ${current.finish}, contient le ${today}`);

  const scopes = payload.connection?.scopes;
  assert.ok(Array.isArray(scopes) && scopes.length > 0, 'health_check : liste des scopes vide');
  console.log(`ok - health_check : ${scopes.length} scopes`);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const mcpToken = randomBytes(32).toString('hex');
const server = startServer(port, mcpToken);

try {
  await waitForServer(baseUrl, server.child);
  console.log(`ok - demarrage : serveur a l'ecoute sur le port ${port}`);
  const rpc = makeRpc(baseUrl, mcpToken);
  await checkInitialize(rpc);
  await checkToolsList(rpc);
  await checkHealth(rpc);
  console.log('smoke : tout est vert');
} catch (error) {
  process.exitCode = 1;
  console.error(`echec - ${error.message}`);
  console.error('--- sortie du serveur ---');
  console.error(server.output());
} finally {
  await stopServer(server.child);
}
