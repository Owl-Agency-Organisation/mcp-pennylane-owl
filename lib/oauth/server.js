// Serveur d'autorisation OAuth 2.1 du serveur MCP, sur la meme origine que
// l'endpoint /api/mcp, qui joue le role de serveur de ressources.
// https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
//
// - Clients identifies par CIMD uniquement, limites a une liste d'hotes.
// - Un seul utilisateur : le proprietaire, authentifie par mot de passe, avec
//   limitation des essais.
// - PKCE S256 obligatoire, parametre `resource` lie au jeton (aud).
// - Jeton d'acces : JWT HS256 verifie sans stockage.
// - Code d'autorisation a usage unique, refresh token avec rotation et
//   detection de reutilisation : stockes par empreinte SHA-256 uniquement.

import { consentPage, errorPage } from './pages.js';
import { OAuthClientError } from './clients.js';
import { pkceChallenge, randomToken, safeEqualStrings, sha256Hex, signJwt, verifyJwt } from './crypto.js';

export const SCOPE = 'pennylane';
// Accepte a la demande pour ne pas rejeter un client qui le sollicite ; un
// refresh token est de toute facon emis.
const ACCEPTED_SCOPES = [SCOPE, 'offline_access'];

export const AUTH_CODE_TTL_S = 60;
export const ACCESS_TOKEN_TTL_S = 3_600;
export const REFRESH_TOKEN_TTL_S = 90 * 24 * 3_600;

// Limitation des essais de mot de passe : par adresse IP, et globalement
// contre les tentatives reparties.
export const LOGIN_MAX_FAILURES_PER_IP = 5;
export const LOGIN_IP_WINDOW_S = 15 * 60;
export const LOGIN_MAX_FAILURES_GLOBAL = 20;
export const LOGIN_GLOBAL_WINDOW_S = 60 * 60;

const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CODE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

const key = {
  code: hash => `oauth:code:${hash}`,
  refresh: hash => `oauth:refresh:${hash}`,
  usedRefresh: hash => `oauth:refresh-used:${hash}`,
  family: id => `oauth:family:${id}`,
  failuresIp: hash => `oauth:login-failures:ip:${hash}`,
  failuresGlobal: 'oauth:login-failures:global',
};

// Forme canonique d'une URL de ressource : schema et hote en minuscules (par
// l'analyse), sans barre oblique finale. Null si l'URL n'est pas acceptable.
export function canonicalResource(value) {
  try {
    const url = new URL(value);
    if (url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

class TokenError extends Error {
  constructor(code, description) {
    super(description);
    this.code = code;
  }
}

function tokenErrorResponse(error) {
  return Response.json(
    { error: error.code, error_description: error.message },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function createOAuthServer({ resource, signingKey, ownerPassword, store, clients, now = () => Date.now() }) {
  const resourceUrl = canonicalResource(resource);
  const issuer = new URL(resourceUrl).origin;
  const resourceMetadataUrl = `${issuer}/.well-known/oauth-protected-resource`;

  const nowSeconds = () => Math.floor(now() / 1000);
  // La cle HMAC s'importe de facon asynchrone : cle ou promesse de cle.
  const keyReady = Promise.resolve(signingKey);

  // ------------------------------------------
  // Metadonnees
  // ------------------------------------------

  function protectedResourceMetadata() {
    return {
      resource: resourceUrl,
      authorization_servers: [issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
    };
  }

  function authorizationServerMetadata() {
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    };
  }

  function wwwAuthenticate() {
    return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${SCOPE}"`;
  }

  // ------------------------------------------
  // Jeton d'acces
  // ------------------------------------------

  async function issueAccessToken({ clientId }) {
    const iat = nowSeconds();
    return signJwt(
      {
        iss: issuer,
        aud: resourceUrl,
        sub: 'owner',
        client_id: clientId,
        scope: SCOPE,
        iat,
        exp: iat + ACCESS_TOKEN_TTL_S,
        jti: randomToken(16),
      },
      await keyReady,
    );
  }

  // Charge utile si le jeton a ete emis ici, pour cette ressource, et n'a pas
  // expire ; sinon null.
  async function verifyAccessToken(token) {
    const claims = await verifyJwt(token, await keyReady);
    if (!claims) return null;
    if (claims.iss !== issuer || claims.aud !== resourceUrl) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds()) return null;
    if (!String(claims.scope ?? '').split(' ').includes(SCOPE)) return null;
    return claims;
  }

  // ------------------------------------------
  // Autorisation
  // ------------------------------------------

  function redirectWith(redirectUri, params) {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(params)) {
      if (value) url.searchParams.set(name, value);
    }
    url.searchParams.set('iss', issuer);
    return new Response(null, { status: 302, headers: { Location: url.href, 'Cache-Control': 'no-store' } });
  }

  // Valide une requete d'autorisation. Tant que redirect_uri n'est pas
  // etabli, une erreur s'affiche ici ; ensuite, elle est renvoyee au client
  // par redirection, jamais vers une URL non verifiee.
  async function validateAuthorizeRequest(params) {
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const state = params.get('state');

    let client;
    try {
      client = await clients.resolve(clientId);
    } catch (error) {
      if (error instanceof OAuthClientError) return { page: errorPage(error.message) };
      throw error;
    }
    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
      return { page: errorPage('redirect_uri absent du document du client.') };
    }
    // HTTPS uniquement : les redirections locales (localhost) ne sont pas
    // acceptees. Claude Code utilise le secret partage.
    if (new URL(redirectUri).protocol !== 'https:') {
      return { page: errorPage('Seules les redirections HTTPS sont acceptees.') };
    }

    const fail = (error, description) => ({
      redirect: redirectWith(redirectUri, { error, error_description: description, state }),
    });

    if (params.get('response_type') !== 'code') {
      return fail('unsupported_response_type', 'response_type doit valoir code.');
    }
    if (params.get('code_challenge_method') !== 'S256' || !CODE_CHALLENGE.test(params.get('code_challenge') ?? '')) {
      return fail('invalid_request', 'PKCE S256 obligatoire.');
    }
    if (canonicalResource(params.get('resource') ?? '') !== resourceUrl) {
      return fail('invalid_target', `resource doit designer ${resourceUrl}.`);
    }
    const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
    if (!scopes.every(scope => ACCEPTED_SCOPES.includes(scope))) {
      return fail('invalid_scope', `Scope accepte : ${SCOPE}.`);
    }

    return {
      request: {
        clientId,
        clientName: client.client_name,
        redirectUri,
        state,
        codeChallenge: params.get('code_challenge'),
      },
    };
  }

  // Parametres renvoyes par le formulaire de consentement.
  const AUTHORIZE_PARAMS = [
    'response_type', 'client_id', 'redirect_uri', 'state', 'scope',
    'code_challenge', 'code_challenge_method', 'resource',
  ];

  function renderConsent(request, params, error, status) {
    return consentPage({
      clientName: request.clientName,
      redirectUri: request.redirectUri,
      params: Object.fromEntries(AUTHORIZE_PARAMS.map(name => [name, params.get(name)])),
      error,
      status,
    });
  }

  async function handleAuthorizeGet(httpRequest) {
    const params = new URL(httpRequest.url).searchParams;
    const { page, redirect, request } = await validateAuthorizeRequest(params);
    if (page) return page;
    if (redirect) return redirect;
    return renderConsent(request, params);
  }

  function clientIp(httpRequest) {
    return (httpRequest.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'inconnue';
  }

  async function handleAuthorizePost(httpRequest) {
    let form;
    try {
      form = await httpRequest.formData();
    } catch {
      return errorPage('Formulaire illisible.');
    }
    const params = new URLSearchParams();
    for (const name of AUTHORIZE_PARAMS) {
      const value = form.get(name);
      if (typeof value === 'string') params.set(name, value);
    }

    // Les champs caches ne font pas foi : la requete est revalidee.
    const { page, redirect, request } = await validateAuthorizeRequest(params);
    if (page) return page;
    if (redirect) return redirect;

    if (form.get('decision') !== 'approve') {
      return redirectWith(request.redirectUri, { error: 'access_denied', state: request.state });
    }

    const ipKey = key.failuresIp(await sha256Hex(clientIp(httpRequest)));
    const [ipFailures, globalFailures] = await Promise.all([
      store.count(ipKey),
      store.count(key.failuresGlobal),
    ]);
    if (ipFailures >= LOGIN_MAX_FAILURES_PER_IP || globalFailures >= LOGIN_MAX_FAILURES_GLOBAL) {
      return renderConsent(request, params, 'Trop d\'essais infructueux. Réessayer plus tard.', 429);
    }

    if (!(await safeEqualStrings(String(form.get('password') ?? ''), ownerPassword))) {
      await Promise.all([
        store.increment(ipKey, LOGIN_IP_WINDOW_S),
        store.increment(key.failuresGlobal, LOGIN_GLOBAL_WINDOW_S),
      ]);
      return renderConsent(request, params, 'Mot de passe incorrect.', 401);
    }
    await store.del(ipKey);

    const code = randomToken(32);
    await store.setJson(
      key.code(await sha256Hex(code)),
      { client_id: request.clientId, redirect_uri: request.redirectUri, code_challenge: request.codeChallenge },
      AUTH_CODE_TTL_S,
      { onlyIfAbsent: true },
    );
    return redirectWith(request.redirectUri, { code, state: request.state });
  }

  // ------------------------------------------
  // Jetons
  // ------------------------------------------

  // Emet un refresh token dans une famille : toutes les rotations d'une meme
  // autorisation. La reutilisation d'un jeton deja echange revoque la famille.
  async function issueRefreshToken({ family, clientId }) {
    const refreshToken = randomToken(32);
    await store.setJson(
      key.refresh(await sha256Hex(refreshToken)),
      { family, client_id: clientId },
      REFRESH_TOKEN_TTL_S,
    );
    return refreshToken;
  }

  async function tokenResponse({ clientId, family }) {
    const [accessToken, refreshToken] = await Promise.all([
      issueAccessToken({ clientId }),
      issueRefreshToken({ family, clientId }),
    ]);
    return Response.json(
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_S,
        refresh_token: refreshToken,
        scope: SCOPE,
      },
      { headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
    );
  }

  function checkResource(form) {
    // Les clients MCP envoient `resource` ; s'il est present, il doit
    // designer ce serveur.
    const requested = form.get('resource');
    if (requested !== null && canonicalResource(requested) !== resourceUrl) {
      throw new TokenError('invalid_target', `resource doit designer ${resourceUrl}.`);
    }
  }

  async function exchangeCode(form) {
    const code = form.get('code');
    const verifier = form.get('code_verifier');
    if (!code || !verifier) throw new TokenError('invalid_request', 'code et code_verifier requis.');
    checkResource(form);

    // GETDEL : un code ne s'echange qu'une fois.
    const stored = await store.takeJson(key.code(await sha256Hex(code)));
    if (!stored) throw new TokenError('invalid_grant', 'Code inconnu, expire ou deja utilise.');
    if (stored.client_id !== form.get('client_id') || stored.redirect_uri !== form.get('redirect_uri')) {
      throw new TokenError('invalid_grant', 'client_id ou redirect_uri different de la demande.');
    }
    if (!CODE_VERIFIER.test(verifier) || (await pkceChallenge(verifier)) !== stored.code_challenge) {
      throw new TokenError('invalid_grant', 'code_verifier invalide.');
    }

    const family = randomToken(16);
    await store.setJson(key.family(family), { client_id: stored.client_id }, REFRESH_TOKEN_TTL_S);
    return tokenResponse({ clientId: stored.client_id, family });
  }

  async function rotateRefreshToken(form) {
    const refreshToken = form.get('refresh_token');
    if (!refreshToken) throw new TokenError('invalid_request', 'refresh_token requis.');
    checkResource(form);

    const hash = await sha256Hex(refreshToken);
    const stored = await store.takeJson(key.refresh(hash));
    if (!stored) {
      const used = await store.getJson(key.usedRefresh(hash));
      if (used) {
        // Un jeton deja echange revient : il a pu etre derobe. Toute la
        // famille est revoquee, le legitime comme l'usurpateur doivent se
        // reconnecter.
        await store.del(key.family(used.family));
        console.warn('[OAuth] Refresh token reutilise : autorisation revoquee.');
      }
      throw new TokenError('invalid_grant', 'Refresh token inconnu, expire ou deja utilise.');
    }
    await store.setJson(key.usedRefresh(hash), { family: stored.family }, REFRESH_TOKEN_TTL_S);

    if (stored.client_id !== form.get('client_id')) {
      throw new TokenError('invalid_grant', 'client_id different de celui du jeton.');
    }
    if (!(await store.getJson(key.family(stored.family)))) {
      throw new TokenError('invalid_grant', 'Autorisation revoquee ou expiree.');
    }
    await store.expire(key.family(stored.family), REFRESH_TOKEN_TTL_S);
    return tokenResponse({ clientId: stored.client_id, family: stored.family });
  }

  async function handleToken(httpRequest) {
    let form;
    try {
      form = await httpRequest.formData();
    } catch {
      return tokenErrorResponse(new TokenError('invalid_request', 'Corps application/x-www-form-urlencoded attendu.'));
    }
    try {
      switch (form.get('grant_type')) {
        case 'authorization_code':
          return await exchangeCode(form);
        case 'refresh_token':
          return await rotateRefreshToken(form);
        default:
          throw new TokenError('unsupported_grant_type', 'grant_type : authorization_code ou refresh_token.');
      }
    } catch (error) {
      if (error instanceof TokenError) return tokenErrorResponse(error);
      throw error;
    }
  }

  return {
    issuer,
    resource: resourceUrl,
    protectedResourceMetadata,
    authorizationServerMetadata,
    wwwAuthenticate,
    verifyAccessToken,
    handleAuthorizeGet,
    handleAuthorizePost,
    handleToken,
  };
}
