import type { AircraftState, ProviderStatus, RegionResponse, SearchResult } from '../../../shared/types';
import { type BBox, inBBox } from '../../../shared/geo';
import { planBuckets, type Bucket } from '../../../shared/buckets';
import { dropStale, mergeAircraft } from '../../../shared/merge';
import { matchesPlan, planSearch } from '../../../shared/search';
import { TokenBucket } from '../lib/tokenBucket';
import { ProviderError, type ProviderAdapter, type ProviderQuery } from '../providers/types';
import type { TrackRecorder } from './trackRecorder';

export interface FlightServiceOptions {
  providers: ProviderAdapter[];
  now?: () => number;
  /** Shared cache lifetime per bucket. 2–5 s keeps upstream load flat no matter how many users watch. */
  cacheTtlMs?: number;
  /** Never serve positions older than this. */
  maxPositionAgeMs?: number;
  /** How long a request may wait for a refresh before stale data is returned. */
  maxWaitMs?: number;
  recorder?: TrackRecorder;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

interface BucketEntry {
  bucket: Bucket;
  aircraft: AircraftState[];
  fetchedAt: number;
  lastRequested: number;
  inflight?: Promise<void>;
  lastError?: string;
}

class ProviderRuntime {
  readonly tokens: TokenBucket;
  blockedUntil = 0;
  failures = 0;
  lastError?: string;
  lastSuccess?: number;

  constructor(
    readonly adapter: ProviderAdapter,
    private readonly now: () => number,
  ) {
    this.tokens = new TokenBucket(adapter.limits.capacity, adapter.limits.refillPerSec, now);
  }

  usable(kind: ProviderQuery['kind']): boolean {
    return this.adapter.supports(kind) && this.now() >= this.blockedUntil;
  }

  /** Back off after an error: honour Retry-After, otherwise exponential (1 s → 60 s; 429s start at 5 s). */
  fail(err: unknown) {
    this.failures++;
    const e = err instanceof ProviderError ? err : new ProviderError(String((err as Error)?.message ?? err));
    this.lastError = e.message;
    const base =
      e.status === 429 ? 5000 : e.status === 401 || e.status === 403 ? 600_000 : e.status === 501 || e.status === 503 ? 60_000 : 1000;
    const backoff = e.retryAfterMs ?? Math.min(60_000, base * 2 ** Math.min(6, this.failures - 1));
    this.blockedUntil = this.now() + backoff;
  }

  succeed() {
    this.failures = 0;
    this.lastError = undefined;
    this.lastSuccess = this.now();
  }

  status(): ProviderStatus {
    const now = this.now();
    return {
      id: this.adapter.id,
      enabled: true,
      ok: now >= this.blockedUntil && this.failures === 0,
      blockedUntil: this.blockedUntil > now ? this.blockedUntil : undefined,
      lastError: this.lastError,
      lastSuccess: this.lastSuccess,
    };
  }
}

/**
 * Fetches live aircraft for map regions on behalf of every user.
 *
 * - The world is split into grid buckets; each bucket is fetched at most once per `cacheTtlMs` and the result is
 *   shared by all requests (in-flight requests are coalesced onto the same promise).
 * - All usable providers are queried for a bucket in parallel (as long as they have tokens) and merged by ICAO hex,
 *   freshest position wins. If no provider has a token, the request waits briefly, then serves stale data.
 * - 429/errors put a provider into exponential backoff (or Retry-After).
 */
export class FlightService {
  private readonly runtimes: ProviderRuntime[];
  private readonly cache = new Map<string, BucketEntry>();
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly maxAge: number;
  private readonly maxWait: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (m: string) => void;

  constructor(private readonly opts: FlightServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.ttl = opts.cacheTtlMs ?? 3000;
    this.maxAge = opts.maxPositionAgeMs ?? 90_000;
    this.maxWait = opts.maxWaitMs ?? 1500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? (() => {});
    this.runtimes = opts.providers.map((p) => new ProviderRuntime(p, this.now));
  }

  providerStatus(): ProviderStatus[] {
    return this.runtimes.map((r) => r.status());
  }

  /** Live aircraft for a view. */
  async region(view: BBox): Promise<RegionResponse> {
    const plan = planBuckets(view);
    const entries = await Promise.all(plan.buckets.map((b) => this.ensureBucket(b)));
    const now = this.now();
    const margin = 0.25;
    const padded: BBox = {
      minLat: view.minLat - margin,
      maxLat: view.maxLat + margin,
      minLon: view.minLon - margin,
      maxLon: view.maxLon + margin,
    };
    const merged = dropStale(
      mergeAircraft(...entries.map((e) => e.aircraft)),
      now,
      this.maxAge,
    ).filter((a) => plan.truncated || inBBox(padded, a.lat, a.lon));
    const stale = entries.some((e) => now - e.fetchedAt > this.ttl * 4);
    const providers = this.providerStatus();
    const allDown = providers.length > 0 && providers.every((p) => !p.ok && p.blockedUntil);
    const neverFetched = entries.length > 0 && entries.every((e) => e.fetchedAt === 0);
    return {
      now,
      aircraft: merged,
      buckets: entries.map((e) => ({ id: e.bucket.id, ageMs: e.fetchedAt ? now - e.fetchedAt : -1, count: e.aircraft.length })),
      truncated: plan.truncated,
      stale,
      providers,
      notice: allDown || (neverFetched && providers.length === 0) ? 'providers_down' : plan.truncated ? 'zoom_in' : stale ? 'partial' : undefined,
    };
  }

  private async ensureBucket(b: Bucket): Promise<BucketEntry> {
    let e = this.cache.get(b.id);
    if (!e) {
      e = { bucket: b, aircraft: [], fetchedAt: 0, lastRequested: 0 };
      this.cache.set(b.id, e);
    }
    e.lastRequested = this.now();
    if (this.now() - e.fetchedAt < this.ttl) return e;
    if (!e.inflight) {
      const entry = e;
      entry.inflight = this.refresh(entry).finally(() => {
        entry.inflight = undefined;
      });
    }
    // Wait for the shared refresh, but never longer than maxWait when we already have something to show.
    if (e.fetchedAt === 0) await e.inflight;
    else await Promise.race([e.inflight, this.sleep(this.maxWait)]);
    return e;
  }

  private async refresh(e: BucketEntry): Promise<void> {
    const q: ProviderQuery = { kind: 'point', lat: e.bucket.lat, lon: e.bucket.lon, radiusNm: e.bucket.radiusNm };
    const results = await this.queryProviders(q, 'all');
    if (results === undefined) {
      e.lastError = 'no provider available';
      return;
    }
    e.aircraft = results;
    e.fetchedAt = this.now();
    e.lastError = undefined;
    this.opts.recorder?.observe(results);
  }

  /**
   * Run a query against providers. mode "all" merges every provider that has a token right now (waiting briefly
   * for the best one if none do); mode "first" stops at the first provider that answers.
   * Returns undefined when nothing could be queried at all.
   */
  private async queryProviders(q: ProviderQuery, mode: 'all' | 'first'): Promise<AircraftState[] | undefined> {
    const usable = this.runtimes.filter((r) => r.usable(q.kind));
    if (usable.length === 0) return undefined;
    let picked = usable.filter((r) => r.tokens.tryTake(r.adapter.cost(q)));
    if (picked.length === 0) {
      // Wait for whichever usable provider gets a token first, if that is soon enough.
      const soonest = usable
        .map((r) => ({ r, ms: r.tokens.msUntil(r.adapter.cost(q)) }))
        .sort((a, b) => a.ms - b.ms)[0];
      if (!soonest || soonest.ms > this.maxWait) return undefined;
      await this.sleep(soonest.ms);
      if (!soonest.r.tokens.tryTake(soonest.r.adapter.cost(q))) return undefined;
      picked = [soonest.r];
    }
    if (mode === 'first') picked = picked.slice(0, 1);
    const settled = await Promise.allSettled(picked.map((r) => r.adapter.fetch(q)));
    const lists: AircraftState[][] = [];
    settled.forEach((s, i) => {
      const r = picked[i];
      if (s.status === 'fulfilled') {
        r.succeed();
        lists.push(s.value);
      } else {
        r.fail(s.reason);
        this.log(`[provider ${r.adapter.id}] ${String((s.reason as Error)?.message ?? s.reason)}`);
      }
    });
    if (lists.length === 0) {
      // Every picked provider failed: try the next usable one once (failover).
      {
        const fallback = this.runtimes.find((r) => !picked.includes(r) && r.usable(q.kind) && r.tokens.tryTake(r.adapter.cost(q)));
        if (fallback) {
          try {
            const res = await fallback.adapter.fetch(q);
            fallback.succeed();
            return res;
          } catch (err) {
            fallback.fail(err);
          }
        }
      }
      return undefined;
    }
    return mergeAircraft(...lists);
  }

  /** Search by flight number / callsign / registration / hex: cached buckets first, then upstream. */
  async search(input: string): Promise<SearchResult> {
    const plan = planSearch(input);
    const now = this.now();
    const local = mergeAircraft(
      ...[...this.cache.values()].map((e) => e.aircraft.filter((a) => matchesPlan(a, plan) && now - a.posTs < this.maxAge)),
    );
    if (local.length) return { query: plan.raw, candidates: plan.callsigns, aircraft: local };
    const queries: ProviderQuery[] = [
      ...plan.callsigns.slice(0, 2).map((callsign) => ({ kind: 'callsign' as const, callsign })),
      ...plan.hexes.slice(0, 1).map((hex) => ({ kind: 'hex' as const, hex })),
      ...plan.regs.slice(0, 1).map((reg) => ({ kind: 'reg' as const, reg })),
    ];
    const found: AircraftState[][] = [];
    for (const q of queries) {
      const res = await this.queryProviders(q, 'first');
      if (res?.length) {
        found.push(res);
        break;
      }
    }
    return { query: plan.raw, candidates: plan.callsigns, aircraft: dropStale(mergeAircraft(...found), now, this.maxAge) };
  }

  /** Latest state for one aircraft (used by alerts). Looks at the cache first. */
  async lookup(target: { hex?: string; callsign?: string }): Promise<AircraftState | undefined> {
    const now = this.now();
    for (const e of this.cache.values()) {
      const hit = e.aircraft.find(
        (a) => (target.hex && a.hex === target.hex) || (target.callsign && a.callsign?.toUpperCase() === target.callsign.toUpperCase()),
      );
      if (hit && now - e.fetchedAt < 30_000) return hit;
    }
    const q: ProviderQuery | undefined = target.hex
      ? { kind: 'hex', hex: target.hex }
      : target.callsign
        ? { kind: 'callsign', callsign: target.callsign }
        : undefined;
    if (!q) return undefined;
    const res = await this.queryProviders(q, 'first');
    return res?.sort((a, b) => b.posTs - a.posTs)[0];
  }

  /** Forget buckets nobody has asked for in a while. */
  prune(idleMs = 5 * 60_000) {
    const now = this.now();
    for (const [id, e] of this.cache) if (now - e.lastRequested > idleMs && !e.inflight) this.cache.delete(id);
  }

  get cachedBuckets(): number {
    return this.cache.size;
  }
}
