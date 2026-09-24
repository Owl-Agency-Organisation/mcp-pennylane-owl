// Primitives cryptographiques du serveur d'autorisation, sur WebCrypto
// uniquement : aucune dependance, et le meme code tourne sur Node et Edge.

const encoder = new TextEncoder();

export function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

// Empreinte d'un code ou d'un jeton : seule forme sous laquelle il est
// stocke.
export async function sha256Hex(text) {
  return Array.from(await sha256(text), byte => byte.toString(16).padStart(2, '0')).join('');
}

// PKCE S256 : BASE64URL(SHA256(code_verifier)).
export async function pkceChallenge(verifier) {
  return base64url(await sha256(verifier));
}

// Comparaison a temps constant de deux chaines de longueurs quelconques :
// les empreintes ont toujours la meme longueur, ce qui ne revele pas celle
// du secret.
export async function safeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function importHmacKey(hexSecret) {
  const bytes = Uint8Array.from(hexSecret.match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const JWT_HEADER = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'at+jwt' })));

export async function signJwt(payload, key) {
  const body = `${JWT_HEADER}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${base64url(signature)}`;
}

// Renvoie la charge utile si la signature est valide, sinon null. Les
// controles de contenu (iss, aud, exp, scope) incombent a l'appelant.
// crypto.subtle.verify compare a temps constant.
export async function verifyJwt(token, key) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== JWT_HEADER) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64url(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
  } catch {
    return null;
  }
}
