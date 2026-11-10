/**
 * OpenStreetMap data for one airport, for the scenery build. Two sources:
 *  - Overpass API (one query per airport; public servers are often overloaded), or
 *  - the main OSM API "map" call for the airport's bounding box, filtered locally to the aerodrome polygon.
 *    This is meant for small extracts: the build is rate-limited, caches every response under .cache/osm/ and never
 *    re-downloads an airport unless --force is given. Do not use it for bulk or runtime traffic.
 * Both return Overpass-style elements with inline geometry, so shared/airport3d.ts `convertOsm` handles either.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Airport } from '../../shared/airports';
import { inRing, isSceneryElement, overpassQuery, type OsmElement } from '../../shared/airport3d';
import { destinationPoint, enuOffsetM } from '../../shared/geo';

const UA = { 'User-Agent': 'SkyView3D-build/0.2 (airport scenery; cached, rate-limited)' };
const OSM_API = 'https://api.openstreetmap.org/api/0.6/map.json';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawEl {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: string; ref: number; role: string }[];
  tags?: Record<string, string>;
}

export interface OsmResult {
  elements: OsmElement[];
  source: 'cache' | 'overpass' | 'osm-api';
}

export class OsmSource {
  private overpassFailures = 0;
  private lastCall = 0;

  constructor(
    private readonly cacheDir: string,
    private readonly mirrors: string[],
    private readonly mode: 'auto' | 'api' | 'overpass' = 'auto',
  ) {
    mkdirSync(cacheDir, { recursive: true });
  }

  cached(icao: string): OsmElement[] | undefined {
    const f = join(this.cacheDir, `${icao}.json`);
    if (!existsSync(f)) return undefined;
    try {
      return (JSON.parse(readFileSync(f, 'utf8')) as { elements: OsmElement[] }).elements;
    } catch {
      return undefined;
    }
  }

  async get(airport: Airport, force = false): Promise<OsmResult> {
    if (!force) {
      const c = this.cached(airport.ident);
      if (c) return { elements: c, source: 'cache' };
    }
    let elements: OsmElement[] | undefined;
    let source: OsmResult['source'] = 'osm-api';
    if (this.mode !== 'api' && this.overpassFailures < 3) {
      try {
        elements = await this.overpass(airport.ident);
        source = 'overpass';
        this.overpassFailures = 0;
      } catch (e) {
        this.overpassFailures++;
        if (this.mode === 'overpass') throw e;
      }
    }
    elements ??= await this.fromApi(airport);
    writeFileSync(join(this.cacheDir, `${airport.ident}.json`), JSON.stringify({ icao: airport.ident, fetched: new Date().toISOString(), source, elements }));
    return { elements, source };
  }

  private async overpass(icao: string): Promise<OsmElement[]> {
    let last: unknown;
    for (const url of this.mirrors) {
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(icao) }), headers: UA, signal: AbortSignal.timeout(100_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return ((await res.json()) as { elements: OsmElement[] }).elements;
      } catch (e) {
        last = e;
      }
    }
    throw last ?? new Error('no Overpass mirror');
  }

  /** Bounding box of the runways (+1.6 km) from the OSM API, reduced to scenery inside the aerodrome. */
  private async fromApi(airport: Airport): Promise<OsmElement[]> {
    const pts = airport.runways.flatMap((r) => [r.le, r.he]).map((e) => ({ lat: e.lat, lon: e.lon }));
    pts.push({ lat: airport.lat, lon: airport.lon });
    const margin = 1600;
    let l = Infinity;
    let b = Infinity;
    let r = -Infinity;
    let t = -Infinity;
    for (const p of pts) {
      for (const brg of [0, 90, 180, 270]) {
        const q = destinationPoint(p.lat, p.lon, brg, margin);
        l = Math.min(l, q.lon);
        r = Math.max(r, q.lon);
        b = Math.min(b, q.lat);
        t = Math.max(t, q.lat);
      }
    }
    const raw = new Map<string, RawEl>();
    for (const e of await this.mapCall(l, b, r, t, 0)) raw.set(`${e.type}${e.id}`, e);
    return reduce(airport, [...raw.values()]);
  }

  private async mapCall(l: number, b: number, r: number, t: number, depth: number): Promise<RawEl[]> {
    const url = `${OSM_API}?bbox=${l.toFixed(5)},${b.toFixed(5)},${r.toFixed(5)},${t.toFixed(5)}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = 1200 - (Date.now() - this.lastCall);
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      let res: Response;
      try {
        res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        if (attempt === 3) throw e;
        await sleep(8000 * (attempt + 1));
        continue;
      }
      if (res.status === 400) {
        // More than 50,000 nodes in the box: split it.
        if (depth >= 4) throw new Error(`OSM API: area too dense (${await res.text()})`);
        const mx = (l + r) / 2;
        const my = (b + t) / 2;
        const out: RawEl[] = [];
        for (const [a, c, d, e] of [
          [l, b, mx, my],
          [mx, b, r, my],
          [l, my, mx, t],
          [mx, my, r, t],
        ]) for (const el of await this.mapCall(a, c, d, e, depth + 1)) out.push(el);
        return out;
      }
      if (res.status === 429 || res.status === 509 || res.status >= 500) {
        await sleep(20_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`OSM API HTTP ${res.status}`);
      return ((await res.json()) as { elements: RawEl[] }).elements;
    }
    throw new Error('OSM API: gave up after retries');
  }
}

/** Raw OSM API elements → scenery elements with inline geometry, limited to this airport. */
export function reduce(airport: Airport, raw: RawEl[]): OsmElement[] {
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways = new Map<number, RawEl>();
  for (const e of raw) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) nodes.set(e.id, { lat: e.lat, lon: e.lon });
    else if (e.type === 'way') ways.set(e.id, e);
  }
  const geomOf = (w: RawEl | undefined) => (w?.nodes ?? []).map((id) => nodes.get(id)).filter((p): p is { lat: number; lon: number } => !!p);
  const out: OsmElement[] = [];
  for (const e of raw) {
    if (!isSceneryElement(e.tags)) continue;
    if (e.type === 'node') {
      if (e.lat !== undefined) out.push({ type: 'node', id: e.id, lat: e.lat, lon: e.lon, tags: e.tags });
    } else if (e.type === 'way') {
      const g = geomOf(e);
      if (g.length >= 2) out.push({ type: 'way', id: e.id, tags: e.tags, geometry: g });
    } else {
      const members = (e.members ?? [])
        .filter((m) => m.type === 'way')
        .map((m) => ({ type: 'way', role: m.role, geometry: geomOf(ways.get(m.ref)) }))
        .filter((m) => m.geometry.length >= 2);
      if (members.length) out.push({ type: 'relation', id: e.id, tags: e.tags, members });
    }
  }
  // Which aerodrome polygon is ours? Tagged with our ICAO/IATA code, else the largest one holding a runway end.
  const local = (p: { lat: number; lon: number }) => {
    const o = enuOffsetM(airport.lat, airport.lon, p.lat, p.lon);
    return [o.east, o.north] as const;
  };
  const ringOf = (e: OsmElement): number[] | undefined => {
    const g = e.type === 'way' ? e.geometry : (e.members ?? []).filter((m) => m.role !== 'inner').sort((a, b) => (b.geometry?.length ?? 0) - (a.geometry?.length ?? 0))[0]?.geometry;
    return g && g.length > 3 ? g.flatMap((p) => [...local(p)]) : undefined;
  };
  const area = (r: number[]) => {
    let a = 0;
    for (let i = 0; i < r.length; i += 2) a += r[i] * r[(i + 3) % r.length] - r[(i + 2) % r.length] * r[i + 1];
    return Math.abs(a / 2);
  };
  const ends = airport.runways.flatMap((r) => [local(r.le), local(r.he)]);
  let boundary: { el: OsmElement; ring: number[]; score: number } | undefined;
  for (const e of out) {
    if (e.tags?.aeroway !== 'aerodrome' || e.type === 'node') continue;
    const ring = ringOf(e);
    if (!ring) continue;
    const coded = e.tags.icao?.toUpperCase() === airport.ident || (!!airport.iata && e.tags.iata?.toUpperCase() === airport.iata);
    const holds = ends.some(([x, y]) => inRing(ring, x, y)) || inRing(ring, 0, 0);
    if (!coded && !holds) continue;
    const score = (coded ? 1e12 : 0) + area(ring);
    if (!boundary || score > boundary.score) boundary = { el: e, ring, score };
  }
  const near = (x: number, y: number) => ends.some(([ex, ey]) => Math.hypot(x - ex, y - ey) < 1500) || Math.hypot(x, y) < 1500;
  const inside = (e: OsmElement): boolean => {
    const pts = e.type === 'node' ? [{ lat: e.lat!, lon: e.lon! }] : e.type === 'way' ? e.geometry! : (e.members ?? []).flatMap((m) => m.geometry ?? []);
    if (!pts.length) return false;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      const [x, y] = local(p);
      cx += x / pts.length;
      cy += y / pts.length;
    }
    if (boundary) return inRing(boundary.ring, cx, cy);
    // No mapped boundary: keep aviation features anywhere in the box, other buildings only near the runways.
    return e.tags?.aeroway ? true : near(cx, cy);
  };
  return out.filter((e) => (e.tags?.aeroway === 'aerodrome' ? e === boundary?.el : inside(e)));
}
