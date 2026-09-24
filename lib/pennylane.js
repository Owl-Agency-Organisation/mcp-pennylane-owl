// Client HTTP de l'API Pennylane : cadence les appels sous la limite de debit
// et reprend apres un 429.
//
// Limite documentee : 25 requetes par fenetre de 5 secondes et par token. Un
// 429 porte l'en-tete `retry-after`, en secondes.
// https://pennylane.readme.io/docs/rate-limiting-1

// Intervalle minimal entre deux appels : 4 requetes par seconde au plus,
// sous la limite de 5.
export const MIN_INTERVAL_MS = 250;

// Au-dela, l'erreur 429 est remontee telle quelle : son corps indique le
// delai de reprise, que le client MCP peut respecter.
export const MAX_RETRIES_ON_429 = 2;
export const MAX_RETRY_AFTER_MS = 10_000;

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// `fetch`, `sleep` et `now` sont injectables pour les tests. Par defaut,
// `fetch` est lu a chaque appel pour rester remplacable a chaud.
export function createPennylaneClient({
  baseUrl,
  token,
  fetch = (...args) => globalThis.fetch(...args),
  sleep = realSleep,
  now = () => Date.now(),
  minIntervalMs = MIN_INTERVAL_MS,
}) {
  // Prochain creneau libre. Chaque appel reserve le sien avant d'attendre :
  // des appels concurrents dans la meme instance restent espaces.
  let nextSlot = 0;

  async function throttle() {
    const current = now();
    const wait = nextSlot - current;
    nextSlot = Math.max(current, nextSlot) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  }

  // Delai de reprise d'un 429, ou null s'il est absent, illisible ou trop
  // long pour etre attendu dans une fonction Vercel.
  function retryDelayMs(res) {
    // En-tete absent : `Number(null)` vaudrait 0 et declencherait une reprise
    // immediate.
    const raw = res.headers?.get?.('retry-after');
    if (raw == null || raw.trim() === '') return null;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const ms = seconds * 1000;
    return ms <= MAX_RETRY_AFTER_MS ? ms : null;
  }

  return async function request(endpoint, options = {}) {
    const method = options.method || 'GET';
    for (let attempt = 0; ; attempt++) {
      await throttle();
      console.log(`[Pennylane] ${method} ${endpoint}`);
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (res.status === 429 && attempt < MAX_RETRIES_ON_429) {
        const delay = retryDelayMs(res);
        if (delay !== null) {
          console.warn(`[Pennylane] 429 sur ${endpoint}, reprise dans ${delay} ms`);
          await sleep(delay);
          continue;
        }
      }

      if (!res.ok) {
        const errorText = await res.text();
        const error = new Error(`Pennylane API error ${res.status}: ${errorText}`);
        error.status = res.status;
        throw error;
      }
      return res.json();
    }
  };
}
