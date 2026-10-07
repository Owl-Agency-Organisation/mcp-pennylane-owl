// Stockage cle-valeur des codes d'autorisation, des refresh tokens et des
// compteurs d'echecs de connexion : Upstash Redis, appele par son API REST.
// https://upstash.com/docs/redis/features/restapi
//
// Aucun code ni jeton n'est stocke en clair : les cles portent leur empreinte
// SHA-256 (voir server.js).

export function createKvStore({ url, token, fetch = (...args) => globalThis.fetch(...args) }) {
  async function command(...args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)),
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      // Corps illisible : l'erreur HTTP ci-dessous suffit.
    }
    if (!res.ok || body.error) {
      throw new Error(`Stockage : ${args[0]} a echoue (${body.error ?? `HTTP ${res.status}`})`);
    }
    return body.result;
  }

  const parse = raw => (raw == null ? null : JSON.parse(raw));

  return {
    // Renvoie false si NX est demande et que la cle existe deja.
    async setJson(key, value, ttlSeconds, { onlyIfAbsent = false } = {}) {
      const result = await command(
        'SET', key, JSON.stringify(value), 'EX', ttlSeconds, ...(onlyIfAbsent ? ['NX'] : []),
      );
      return result === 'OK';
    },
    async getJson(key) {
      return parse(await command('GET', key));
    },
    // Lecture et suppression atomiques : garantit l'usage unique.
    async takeJson(key) {
      return parse(await command('GETDEL', key));
    },
    async del(key) {
      await command('DEL', key);
    },
    async expire(key, ttlSeconds) {
      await command('EXPIRE', key, ttlSeconds);
    },
    async count(key) {
      return Number(await command('GET', key)) || 0;
    },
    // Incremente un compteur ; la fenetre demarre au premier increment.
    async increment(key, windowSeconds) {
      const value = await command('INCR', key);
      if (value === 1) await command('EXPIRE', key, windowSeconds);
      return value;
    },
  };
}
