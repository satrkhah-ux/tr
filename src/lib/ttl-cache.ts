import "server-only";

/**
 * A small in-process cache with an expiry, for answers every request asks the
 * database for again: who the session is, its permissions, the service
 * switches. The server runs in Frankfurt and the database in Mumbai
 * (ap-south-1), so each of those questions is a 0.2–0.5 s round trip — four of
 * them in a row before any page could start (2026-10-17 slowness report).
 *
 * The expiry is the price: a change (a role edited, an account suspended, a
 * switch flipped) reaches a request at most `ttlMs` later. Keep it short where
 * that matters, and call delete()/clear() where this process makes the change.
 *
 * ponytail: per process and unbounded in time only by `ttlMs`; a second server
 * instance would need a shared cache (Redis) — there is one container today.
 */
export function ttlCache<K, V>(ttlMs: number, max = 1000) {
  const entries = new Map<K, { value: V; until: number }>();
  return {
    get(key: K): V | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.until < Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: K, value: V): void {
      // the oldest insert goes first once full — enough for a few hundred staff
      if (entries.size >= max) entries.delete(entries.keys().next().value as K);
      entries.set(key, { value, until: Date.now() + ttlMs });
    },
    delete(key: K): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
  };
}
