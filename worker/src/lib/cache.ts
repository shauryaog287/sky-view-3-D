/**
 * Two-level cache for slow-changing upstream data (enrichment, weather):
 *  1. in-isolate LRU (free, instant),
 *  2. Cloudflare Cache API (per data centre, no write limits, honours max-age).
 * KV is deliberately not used: free-tier KV allows 1,000 writes/day and has a 60 s minimum TTL.
 */
export class Lru<V> {
  private readonly map = new Map<string, { v: V; exp: number }>();
  constructor(private readonly max = 500) {}
  get(k: string, now = Date.now()): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < now) {
      this.map.delete(k);
      return undefined;
    }
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }
  set(k: string, v: V, ttlMs: number, now = Date.now()) {
    this.map.delete(k);
    this.map.set(k, { v, exp: now + ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

const memory = new Lru<unknown>(1000);

function edgeCache(): Cache | undefined {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  } catch {
    return undefined;
  }
}

/** Get-or-compute with both cache levels. `null` results are cached too (negative caching) for `negativeTtlS`. */
export async function cached<T>(key: string, ttlS: number, compute: () => Promise<T | null>, negativeTtlS = 600): Promise<T | null> {
  const mem = memory.get(key) as { v: T | null } | undefined;
  if (mem) return mem.v;
  const cache = edgeCache();
  const req = new Request(`https://cache.skyview.internal/${encodeURIComponent(key)}`);
  if (cache) {
    const hit = await cache.match(req);
    if (hit) {
      const v = (await hit.json()) as { v: T | null };
      memory.set(key, v, Math.min(ttlS, 300) * 1000);
      return v.v;
    }
  }
  const v = await compute();
  const ttl = v === null ? negativeTtlS : ttlS;
  memory.set(key, { v }, Math.min(ttl, 300) * 1000);
  if (cache) {
    await cache.put(req, new Response(JSON.stringify({ v }), { headers: { 'Cache-Control': `max-age=${ttl}`, 'Content-Type': 'application/json' } }));
  }
  return v;
}
