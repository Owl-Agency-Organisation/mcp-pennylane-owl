import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthServer, ACCESS_TOKEN_TTL_S, AUTH_CODE_TTL_S, LOGIN_MAX_FAILURES_PER_IP } from '../lib/oauth/server.js';
import { createKvStore } from '../lib/oauth/store.js';
import { createClientResolver } from '../lib/oauth/clients.js';
import { importHmacKey, pkceChallenge, signJwt } from '../lib/oauth/crypto.js';
import { oauthFromEnv } from '../lib/oauth/env.js';

const RESOURCE = 'https://mcp.exemple.test/api/mcp';
const ISSUER = 'https://mcp.exemple.test';
const PASSWORD = 'mot-de-passe-du-proprietaire-de-test';
const KV_URL = 'https://kv.exemple.test';
const SIGNING_HEX = 'ab'.repeat(32);

const CLAUDE_ID = 'https://claude.ai/oauth/client-de-test';
const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const CLIENT_DOCS = {
  [CLAUDE_ID]: { client_id: CLAUDE_ID, client_name: 'Claude', redirect_uris: [CLAUDE_REDIRECT] },
  'https://claude.ai/oauth/claude-code-client-metadata': {
    client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
    client_name: 'Claude Code',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  },
  'https://claude.ai/oauth/document-incoherent': {
    client_id: 'https://claude.ai/oauth/autre-chose',
    client_name: 'Incoherent',
    redirect_uris: [CLAUDE_REDIRECT],
  },
};

const VERIFIER = 'v'.repeat(43) + '-verifier-de-test';

// ============================================
// HARNESS
// ============================================

// Horloge simulee, partagee par le serveur et le faux stockage.
let clock;
// Faux Upstash : interprete les commandes REST, avec expiration.
let kvData;

function kvCommand([name, key, ...rest]) {
  const alive = k => {
    const entry = kvData.get(k);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= clock) kvData.delete(k);
    return kvData.get(k);
  };
  switch (name) {
    case 'SET': {
      const ttl = rest.includes('EX') ? Number(rest[rest.indexOf('EX') + 1]) : null;
      if (rest.includes('NX') && alive(key)) return null;
      kvData.set(key, { value: rest[0], expiresAt: ttl ? clock + ttl * 1000 : null });
      return 'OK';
    }
    case 'GET':
      return alive(key)?.value ?? null;
    case 'GETDEL': {
      const value = alive(key)?.value ?? null;
      kvData.delete(key);
      return value;
    }
    case 'DEL':
      return kvData.delete(key) ? 1 : 0;
    case 'EXPIRE': {
      const entry = alive(key);
      if (entry) entry.expiresAt = clock + Number(rest[0]) * 1000;
      return entry ? 1 : 0;
    }
    case 'INCR': {
      const entry = alive(key);
      const value = Number(entry?.value ?? 0) + 1;
      kvData.set(key, { value: String(value), expiresAt: entry?.expiresAt ?? null });
      return value;
    }
    default:
      throw new Error(`commande non simulee : ${name}`);
  }
}

async function fakeFetch(url, init = {}) {
  if (url === KV_URL) {
    assert.equal(init.headers.Authorization, 'Bearer jeton-kv');
    return Response.json({ result: kvCommand(JSON.parse(init.body)) });
  }
  const doc = CLIENT_DOCS[url];
  return doc ? Response.json(doc) : new Response('introuvable', { status: 404 });
}

async function makeServer() {
  return createOAuthServer({
    resource: RESOURCE,
    signingKey: await importHmacKey(SIGNING_HEX),
    ownerPassword: PASSWORD,
    store: createKvStore({ url: KV_URL, token: 'jeton-kv', fetch: fakeFetch }),
    clients: createClientResolver({ allowedHosts: ['claude.ai', 'chatgpt.com'], fetch: fakeFetch, now: () => clock }),
    now: () => clock,
  });
}

let server;
let challenge;

beforeEach(async () => {
  clock = 1_800_000_000_000;
  kvData = new Map();
  server = await makeServer();
  challenge = await pkceChallenge(VERIFIER);
});

function authorizeParams(overrides = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLAUDE_ID,
    redirect_uri: CLAUDE_REDIRECT,
    state: 'etat-123',
    scope: 'pennylane',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    ...overrides,
  });
}

const authorizeGet = params =>
  server.handleAuthorizeGet(new Request(`${ISSUER}/oauth/authorize?${params}`));

function authorizePost(params, { password = PASSWORD, decision = 'approve', ip = '203.0.113.7' } = {}) {
  const form = new URLSearchParams(params);
  form.set('password', password);
  form.set('decision', decision);
  return server.handleAuthorizePost(new Request(`${ISSUER}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: form,
  }));
}

function token(fields) {
  return server.handleToken(new Request(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  }));
}

const locationOf = response => new URL(response.headers.get('location'));

async function obtainCode(overrides) {
  const response = await authorizePost(authorizeParams(overrides));
  assert.equal(response.status, 302);
  return locationOf(response).searchParams.get('code');
}

async function obtainTokens() {
  const code = await obtainCode();
  const response = await token({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CLAUDE_REDIRECT,
    client_id: CLAUDE_ID,
    code_verifier: VERIFIER,
    resource: RESOURCE,
  });
  assert.equal(response.status, 200);
  return response.json();
}

// ============================================
// TESTS
// ============================================

describe('oauth : metadonnees', () => {
  it('publie la ressource protegee et son serveur d autorisation', () => {
    assert.deepEqual(server.protectedResourceMetadata(), {
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: ['pennylane'],
      bearer_methods_supported: ['header'],
    });
  });

  it('annonce ce que Claude et ChatGPT exigent pour choisir CIMD', () => {
    const metadata = server.authorizationServerMetadata();

    assert.equal(metadata.issuer, ISSUER);
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
    assert.equal(metadata.client_id_metadata_document_supported, true);
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    assert.equal(metadata.registration_endpoint, undefined, 'pas de DCR');
  });

  it('pointe le defi 401 vers les metadonnees', () => {
    assert.equal(
      server.wwwAuthenticate(),
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource", scope="pennylane"`,
    );
  });
});

describe('oauth : requete d autorisation', () => {
  it('affiche le consentement avec le client et l hote de redirection', async () => {
    const response = await authorizeGet(authorizeParams());
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Claude/);
    assert.match(html, /claude\.ai/);
    assert.match(html, /type="password"/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  });

  it('refuse un client hors de la liste d hotes, sans rediriger', async () => {
    const response = await authorizeGet(authorizeParams({ client_id: 'https://pirate.exemple/client.json' }));

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
  });

  it('refuse une redirection absente du document du client, sans rediriger', async () => {
    const response = await authorizeGet(authorizeParams({ redirect_uri: 'https://pirate.exemple/callback' }));

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
  });

  it('refuse les redirections locales : Claude Code passe par le secret partage', async () => {
    const response = await authorizeGet(authorizeParams({
      client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
      redirect_uri: 'http://localhost/callback',
    }));

    assert.equal(response.status, 400);
    assert.match(await response.text(), /HTTPS/);
  });

  it('refuse un document dont le client_id ne correspond pas a son URL', async () => {
    const response = await authorizeGet(authorizeParams({ client_id: 'https://claude.ai/oauth/document-incoherent' }));

    assert.equal(response.status, 400);
  });

  it('renvoie au client une requete sans PKCE S256, avec state et iss', async () => {
    const response = await authorizeGet(authorizeParams({ code_challenge_method: 'plain' }));
    const location = locationOf(response);

    assert.equal(response.status, 302);
    assert.equal(location.origin + location.pathname, CLAUDE_REDIRECT);
    assert.equal(location.searchParams.get('error'), 'invalid_request');
    assert.equal(location.searchParams.get('state'), 'etat-123');
    assert.equal(location.searchParams.get('iss'), ISSUER);
  });

  it('renvoie invalid_target pour une autre ressource', async () => {
    const response = await authorizeGet(authorizeParams({ resource: 'https://autre.exemple/mcp' }));

    assert.equal(locationOf(response).searchParams.get('error'), 'invalid_target');
  });

  it('renvoie invalid_scope pour un scope inconnu', async () => {
    const response = await authorizeGet(authorizeParams({ scope: 'pennylane admin' }));

    assert.equal(locationOf(response).searchParams.get('error'), 'invalid_scope');
  });
});

describe('oauth : consentement', () => {
  it('renvoie access_denied quand le proprietaire refuse', async () => {
    const response = await authorizePost(authorizeParams(), { decision: 'deny' });

    assert.equal(locationOf(response).searchParams.get('error'), 'access_denied');
  });

  it('refuse un mauvais mot de passe sans emettre de code', async () => {
    const response = await authorizePost(authorizeParams(), { password: 'faux' });

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('location'), null);
    assert.ok(![...kvData.keys()].some(k => k.startsWith('oauth:code:')));
  });

  it('bloque apres trop d echecs, meme avec le bon mot de passe', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP; i++) {
      await authorizePost(authorizeParams(), { password: 'faux' });
    }

    const response = await authorizePost(authorizeParams());

    assert.equal(response.status, 429);
  });

  it('limite par adresse : une autre adresse peut encore essayer', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP; i++) {
      await authorizePost(authorizeParams(), { password: 'faux', ip: '203.0.113.7' });
    }

    const response = await authorizePost(authorizeParams(), { ip: '198.51.100.9' });

    assert.equal(response.status, 302);
  });

  it('emet un code avec state et iss, stocke par empreinte seulement', async () => {
    const response = await authorizePost(authorizeParams());
    const location = locationOf(response);
    const code = location.searchParams.get('code');

    assert.ok(code);
    assert.equal(location.searchParams.get('state'), 'etat-123');
    assert.equal(location.searchParams.get('iss'), ISSUER);
    const stored = JSON.stringify([...kvData]);
    assert.ok(!stored.includes(code), 'le code ne doit jamais etre stocke en clair');
  });

  it('revalide les champs caches a la soumission', async () => {
    const response = await authorizePost(authorizeParams({ redirect_uri: 'https://pirate.exemple/callback' }));

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
  });
});

describe('oauth : echange du code', () => {
  it('emet un jeton d acces lie a la ressource, et un refresh token', async () => {
    const body = await obtainTokens();

    assert.equal(body.token_type, 'Bearer');
    assert.equal(body.expires_in, ACCESS_TOKEN_TTL_S);
    assert.ok(body.refresh_token);
    const claims = await server.verifyAccessToken(body.access_token);
    assert.equal(claims.aud, RESOURCE);
    assert.equal(claims.iss, ISSUER);
    assert.equal(claims.client_id, CLAUDE_ID);
  });

  it('ne stocke jamais le refresh token en clair', async () => {
    const body = await obtainTokens();

    assert.ok(!JSON.stringify([...kvData]).includes(body.refresh_token));
  });

  it('refuse un code deja utilise', async () => {
    const code = await obtainCode();
    const fields = {
      grant_type: 'authorization_code', code, redirect_uri: CLAUDE_REDIRECT,
      client_id: CLAUDE_ID, code_verifier: VERIFIER, resource: RESOURCE,
    };

    assert.equal((await token(fields)).status, 200);
    const second = await token(fields);
    assert.equal(second.status, 400);
    assert.equal((await second.json()).error, 'invalid_grant');
  });

  it('refuse un code_verifier qui ne correspond pas', async () => {
    const code = await obtainCode();
    const response = await token({
      grant_type: 'authorization_code', code, redirect_uri: CLAUDE_REDIRECT,
      client_id: CLAUDE_ID, code_verifier: 'x'.repeat(43), resource: RESOURCE,
    });

    assert.equal((await response.json()).error, 'invalid_grant');
  });

  it('refuse un code expire', async () => {
    const code = await obtainCode();
    clock += (AUTH_CODE_TTL_S + 1) * 1000;

    const response = await token({
      grant_type: 'authorization_code', code, redirect_uri: CLAUDE_REDIRECT,
      client_id: CLAUDE_ID, code_verifier: VERIFIER, resource: RESOURCE,
    });

    assert.equal((await response.json()).error, 'invalid_grant');
  });

  it('refuse une autre redirect_uri que celle de la demande', async () => {
    const code = await obtainCode();
    const response = await token({
      grant_type: 'authorization_code', code, redirect_uri: 'https://claude.ai/autre',
      client_id: CLAUDE_ID, code_verifier: VERIFIER, resource: RESOURCE,
    });

    assert.equal((await response.json()).error, 'invalid_grant');
  });

  it('refuse un corps JSON : le point de jeton attend du form-urlencoded', async () => {
    const response = await server.handleToken(new Request(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code' }),
    }));

    assert.equal((await response.json()).error, 'invalid_request');
  });

  it('refuse un grant_type inconnu', async () => {
    const response = await token({ grant_type: 'client_credentials' });

    assert.equal((await response.json()).error, 'unsupported_grant_type');
  });
});

describe('oauth : refresh token', () => {
  const refresh = refreshToken => token({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLAUDE_ID, resource: RESOURCE,
  });

  it('fait tourner le refresh token a chaque usage', async () => {
    const first = await obtainTokens();

    const response = await refresh(first.refresh_token);
    const second = await response.json();

    assert.equal(response.status, 200);
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.ok(await server.verifyAccessToken(second.access_token));
  });

  it('revoque toute l autorisation si un refresh token deja echange revient', async () => {
    const first = await obtainTokens();
    const second = await (await refresh(first.refresh_token)).json();

    const replay = await refresh(first.refresh_token);
    assert.equal((await replay.json()).error, 'invalid_grant');

    // Le jeton legitime issu de la rotation est lui aussi invalide.
    const afterRevocation = await refresh(second.refresh_token);
    assert.equal((await afterRevocation.json()).error, 'invalid_grant');
  });

  it('refuse un refresh token presente par un autre client', async () => {
    const first = await obtainTokens();

    const response = await token({
      grant_type: 'refresh_token', refresh_token: first.refresh_token,
      client_id: 'https://chatgpt.com/oauth/client.json', resource: RESOURCE,
    });

    assert.equal((await response.json()).error, 'invalid_grant');
  });
});

describe('oauth : verification du jeton d acces', () => {
  it('refuse un jeton expire', async () => {
    const { access_token } = await obtainTokens();
    clock += (ACCESS_TOKEN_TTL_S + 1) * 1000;

    assert.equal(await server.verifyAccessToken(access_token), null);
  });

  it('refuse un jeton emis pour une autre ressource', async () => {
    const key = await importHmacKey(SIGNING_HEX);
    const iat = Math.floor(clock / 1000);
    const foreign = await signJwt(
      { iss: ISSUER, aud: 'https://autre.exemple/mcp', scope: 'pennylane', iat, exp: iat + 60 },
      key,
    );

    assert.equal(await server.verifyAccessToken(foreign), null);
  });

  it('refuse un jeton signe avec une autre cle', async () => {
    const key = await importHmacKey('cd'.repeat(32));
    const iat = Math.floor(clock / 1000);
    const forged = await signJwt({ iss: ISSUER, aud: RESOURCE, scope: 'pennylane', iat, exp: iat + 60 }, key);

    assert.equal(await server.verifyAccessToken(forged), null);
  });

  it('refuse un jeton altere', async () => {
    const { access_token } = await obtainTokens();
    const [header, payload, signature] = access_token.split('.');
    const tampered = `${header}.${payload.slice(0, -2)}AA.${signature}`;

    assert.equal(await server.verifyAccessToken(tampered), null);
  });
});

describe('oauth : configuration', () => {
  const ENV = {
    MCP_PUBLIC_URL: RESOURCE,
    OAUTH_SIGNING_KEY: SIGNING_HEX,
    OAUTH_OWNER_PASSWORD: PASSWORD,
    KV_REST_API_URL: KV_URL,
    KV_REST_API_TOKEN: 'jeton-kv',
  };

  it('reste desactive sans aucune variable', () => {
    assert.equal(oauthFromEnv({}), null);
  });

  it('se desactive si une variable manque', () => {
    const { KV_REST_API_TOKEN, ...partial } = ENV;
    assert.equal(oauthFromEnv(partial), null);
  });

  it('se desactive avec un mot de passe trop court ou une cle invalide', () => {
    assert.equal(oauthFromEnv({ ...ENV, OAUTH_OWNER_PASSWORD: 'court' }), null);
    assert.equal(oauthFromEnv({ ...ENV, OAUTH_SIGNING_KEY: 'pas-hexadecimal' }), null);
    assert.equal(oauthFromEnv({ ...ENV, MCP_PUBLIC_URL: 'http://mcp.exemple.test/api/mcp' }), null);
  });

  it('s active avec une configuration complete', () => {
    const configured = oauthFromEnv(ENV);
    assert.equal(configured.resource, RESOURCE);
    assert.equal(configured.issuer, ISSUER);
  });
});
