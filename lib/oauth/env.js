// Configuration du serveur d'autorisation depuis l'environnement.

import { createClientResolver } from './clients.js';
import { importHmacKey } from './crypto.js';
import { canonicalResource, createOAuthServer } from './server.js';
import { createKvStore } from './store.js';

// Seuls ces hotes peuvent heberger le document d'un client (CIMD).
export const ALLOWED_CLIENT_HOSTS = ['claude.ai', 'chatgpt.com'];

// Variables injectees par l'integration Upstash du Marketplace Vercel.
const REQUIRED = ['MCP_PUBLIC_URL', 'OAUTH_SIGNING_KEY', 'OAUTH_OWNER_PASSWORD', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];

const MIN_PASSWORD_LENGTH = 16;

// Serveur d'autorisation, ou null tant qu'OAuth n'est pas configure :
// l'endpoint MCP n'accepte alors que le secret partage. Une configuration
// incomplete ou invalide desactive OAuth et le journalise, sans jamais
// afficher de valeur.
export function oauthFromEnv(env = process.env) {
  const missing = REQUIRED.filter(name => !env[name]);
  if (missing.length === REQUIRED.length) return null;

  const problems = missing.map(name => `${name} manquant`);
  if (env.OAUTH_SIGNING_KEY && !/^([0-9a-f]{2}){32,}$/i.test(env.OAUTH_SIGNING_KEY)) {
    problems.push('OAUTH_SIGNING_KEY doit etre une cle hexadecimale d\'au moins 32 octets');
  }
  if (env.OAUTH_OWNER_PASSWORD && env.OAUTH_OWNER_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    problems.push(`OAUTH_OWNER_PASSWORD doit compter au moins ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  if (env.MCP_PUBLIC_URL && !canonicalResource(env.MCP_PUBLIC_URL)?.startsWith('https://')) {
    problems.push('MCP_PUBLIC_URL doit etre une URL HTTPS sans requete ni fragment');
  }
  if (problems.length > 0) {
    console.error(`[OAuth] Desactive : ${problems.join(' ; ')}.`);
    return null;
  }

  return createOAuthServer({
    resource: env.MCP_PUBLIC_URL,
    signingKey: importHmacKey(env.OAUTH_SIGNING_KEY),
    ownerPassword: env.OAUTH_OWNER_PASSWORD,
    store: createKvStore({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN }),
    clients: createClientResolver({ allowedHosts: ALLOWED_CLIENT_HOSTS }),
  });
}
