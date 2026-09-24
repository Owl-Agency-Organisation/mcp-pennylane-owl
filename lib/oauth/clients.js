// Clients OAuth identifies par Client ID Metadata Document (CIMD) : le
// client_id est l'URL HTTPS d'un document JSON decrivant le client. Aucun
// registre de clients n'est stocke : le document est lu a la demande, puis
// garde en memoire.
// https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration

export class OAuthClientError extends Error {}

const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 16_384;
const DEFAULT_CACHE_SECONDS = 300;
const MAX_CACHE_SECONDS = 3_600;

// Duree de cache : max-age de Cache-Control, borne, ou 5 minutes.
function cacheSeconds(res) {
  const match = /max-age=(\d+)/.exec(res.headers?.get?.('cache-control') ?? '');
  return match ? Math.min(Number(match[1]), MAX_CACHE_SECONDS) : DEFAULT_CACHE_SECONDS;
}

export function createClientResolver({
  allowedHosts,
  fetch = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
}) {
  const cache = new Map();

  // Seules les URL HTTPS d'un hote de la liste sont lues : la liste ferme la
  // porte aux requetes forgees vers d'autres serveurs (SSRF).
  function checkClientId(clientId) {
    let url;
    try {
      url = new URL(clientId);
    } catch {
      throw new OAuthClientError('client_id doit etre une URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      throw new OAuthClientError('client_id doit etre une URL HTTPS simple.');
    }
    if (!allowedHosts.includes(url.hostname)) {
      throw new OAuthClientError(`Client non autorise : ${url.hostname}.`);
    }
    if (url.pathname === '/' || url.pathname === '') {
      throw new OAuthClientError('client_id doit comporter un chemin.');
    }
  }

  async function fetchDocument(clientId) {
    let res;
    try {
      res = await fetch(clientId, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new OAuthClientError('Document du client injoignable.');
    }
    if (!res.ok) throw new OAuthClientError(`Document du client : HTTP ${res.status}.`);
    const text = await res.text();
    if (text.length > MAX_DOCUMENT_BYTES) throw new OAuthClientError('Document du client trop volumineux.');

    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      throw new OAuthClientError('Document du client illisible.');
    }
    if (doc?.client_id !== clientId) {
      throw new OAuthClientError('Le client_id du document ne correspond pas a son URL.');
    }
    if (typeof doc.client_name !== 'string' || !doc.client_name) {
      throw new OAuthClientError('Document du client sans client_name.');
    }
    if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0
      || !doc.redirect_uris.every(uri => typeof uri === 'string')) {
      throw new OAuthClientError('Document du client sans redirect_uris.');
    }
    return { doc, ttl: cacheSeconds(res) };
  }

  return {
    async resolve(clientId) {
      if (typeof clientId !== 'string' || !clientId) throw new OAuthClientError('client_id manquant.');
      checkClientId(clientId);

      const cached = cache.get(clientId);
      if (cached && cached.expiresAt > now()) return cached.doc;

      const { doc, ttl } = await fetchDocument(clientId);
      cache.set(clientId, { doc, expiresAt: now() + ttl * 1000 });
      return doc;
    },
  };
}
