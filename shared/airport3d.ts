import { enuOffsetM } from './geo';

/**
 * 3D airport scenery from OpenStreetMap (© OpenStreetMap contributors, ODbL): terminals, hangars, control towers,
 * jet bridges, canopies — plus aprons and taxiways for when no imagery is available.
 * Compact format: coordinates are local east/north metres relative to the airport reference point.
 */
export type BuildingKind = 'terminal' | 'hangar' | 'tower' | 'building' | 'roof' | 'parking';

export interface Building3D {
  k: BuildingKind;
  /** Roof height above ground, m. */
  h: number;
  /** Base height above ground (canopies, bridges), m. */
  min?: number;
  /** Outer ring as flat [x0, y0, x1, y1, …] east/north metres. */
  ring: number[];
  holes?: number[][];
}

export interface Bridge3D {
  line: number[];
  w: number;
}

export interface Tower3D {
  x: number;
  y: number;
  /** Eye height of the cab, m above ground. */
  h: number;
  /** Footprint radius, m. */
  r: number;
}

export interface Airport3D {
  v: 1;
  icao: string;
  origin: [number, number];
  generated: string;
  attribution: string;
  buildings: Building3D[];
  bridges: Bridge3D[];
  towers: Tower3D[];
  aprons: number[][];
  taxiways: { w: number; line: number[] }[];
}

interface OsmLatLon {
  lat: number;
  lon: number;
}
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: OsmLatLon[];
  members?: { type: string; role: string; geometry?: OsmLatLon[] }[];
}

/** Overpass QL for everything we draw at one aerodrome (its OSM polygon, matched by ICAO code). */
export function overpassQuery(icao: string): string {
  const c = icao.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return `[out:json][timeout:90];
(way["aeroway"="aerodrome"]["icao"="${c}"];relation["aeroway"="aerodrome"]["icao"="${c}"];)->.ad;
.ad map_to_area->.a;
(
  way(area.a)["aeroway"~"^(terminal|hangar|tower|control_tower|control_center|jet_bridge|apron|taxiway|taxilane)$"];
  way(area.a)["building"];
  relation(area.a)["building"];
  relation(area.a)["aeroway"~"^(terminal|hangar|apron)$"];
  node(area.a)["aeroway"="control_tower"];
);
out geom;`;
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(m|ft)?/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2]?.toLowerCase() === 'ft' ? n * 0.3048 : n;
}

function kindOf(t: Record<string, string>): BuildingKind | undefined {
  const a = t.aeroway;
  const b = t.building;
  if (a === 'tower' || a === 'control_tower' || (t.man_made === 'tower' && /air_traffic|control/.test(t['tower:type'] ?? ''))) return 'tower';
  if (a === 'terminal' || b === 'terminal') return 'terminal';
  if (a === 'hangar' || b === 'hangar') return 'hangar';
  if (b === 'roof' || t['building:part'] === 'roof') return 'roof';
  if (b === 'parking' || t.amenity === 'parking') return 'parking';
  if (b || a === 'control_center') return 'building';
  return undefined;
}

/** Heights: tagged height, else levels, else sensible defaults per kind. */
function heights(k: BuildingKind, t: Record<string, string>, areaM2: number, towerHeightM?: number): { h: number; min?: number } {
  const tagged = num(t.height);
  // Control towers: OSM levels usually count only the cab, so prefer an explicit height, then the curated value.
  if (k === 'tower' && areaM2 < 2500) return { h: tagged ?? towerHeightM ?? 50 };
  const levels = num(t['building:levels']);
  const min = num(t.min_height) ?? (num(t['building:min_level']) !== undefined ? num(t['building:min_level'])! * 3.5 : undefined);
  const perLevel = k === 'terminal' ? 5.5 : 3.5;
  let h = tagged ?? (levels !== undefined ? levels * perLevel + 2 : undefined);
  if (h === undefined) {
    h =
      k === 'terminal' ? (areaM2 > 20_000 ? 28 : 18)
      : k === 'hangar' ? (areaM2 > 8000 ? 24 : 15)
      : k === 'tower' ? (areaM2 < 2500 ? 45 : 18)
      : k === 'roof' ? 9
      : k === 'parking' ? 12
      : areaM2 > 5000 ? 12 : 8;
  }
  if (k === 'roof') return { h: Math.max(h, 6), min: min ?? Math.max(4, h - 1.5) };
  return { h: Math.max(3, h), min };
}

function ringArea(r: number[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return Math.abs(a / 2);
}

/** Douglas–Peucker on flat [x,y,…] arrays. */
export function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n <= 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = pts[s * 2];
    const ay = pts[s * 2 + 1];
    const bx = pts[e * 2];
    const by = pts[e * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * pts[i * 2] - dx * pts[i * 2 + 1] + bx * ay - by * ax) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

export function convertOsm(
  icao: string,
  origin: [number, number],
  elements: OsmElement[],
  generated = new Date().toISOString().slice(0, 10),
  opts: { towerHeightM?: number } = {},
): Airport3D {
  const [oLat, oLon] = origin;
  const local = (g: OsmLatLon[], closed: boolean, tol = 0.6): number[] => {
    const flat: number[] = [];
    for (const p of g) {
      const o = enuOffsetM(oLat, oLon, p.lat, p.lon);
      flat.push(Math.round(o.east * 10) / 10, Math.round(o.north * 10) / 10);
    }
    if (closed && flat.length >= 4 && flat[0] === flat[flat.length - 2] && flat[1] === flat[flat.length - 1]) flat.length -= 2;
    return simplify(flat, tol);
  };
  const out: Airport3D = {
    v: 1,
    icao,
    origin,
    generated,
    attribution: '© OpenStreetMap contributors (ODbL)',
    buildings: [],
    bridges: [],
    towers: [],
    aprons: [],
    taxiways: [],
  };
  const isClosed = (g?: OsmLatLon[]) => !!g && g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

  for (const e of elements) {
    const t = e.tags ?? {};
    const a = t.aeroway;
    if (e.type === 'node') {
      if (a === 'control_tower' && e.lat !== undefined && e.lon !== undefined) {
        const o = enuOffsetM(oLat, oLon, e.lat, e.lon);
        out.towers.push({ x: Math.round(o.east), y: Math.round(o.north), h: (num(t.height) ?? opts.towerHeightM ?? 50) - 4, r: 8 });
      }
      continue;
    }
    if (e.type === 'way' && (a === 'taxiway' || a === 'taxilane') && e.geometry && !isClosed(e.geometry)) {
      out.taxiways.push({ w: num(t.width) ?? (a === 'taxilane' ? 15 : 23), line: local(e.geometry, false, 1.5) });
      continue;
    }
    if (e.type === 'way' && a === 'jet_bridge' && e.geometry) {
      const line = local(e.geometry, false, 0.3);
      if (line.length >= 4) out.bridges.push({ line, w: num(t.width) ?? 3.6 });
      continue;
    }
    if (a === 'apron') {
      if (e.type === 'way' && isClosed(e.geometry)) out.aprons.push(local(e.geometry!, true, 1.5));
      else for (const m of e.members ?? []) if (m.role === 'outer' && isClosed(m.geometry)) out.aprons.push(local(m.geometry!, true, 1.5));
      continue;
    }
    const k = kindOf(t);
    if (!k) continue;
    const rings: { ring: number[]; holes: number[][] }[] = [];
    if (e.type === 'way' && isClosed(e.geometry)) rings.push({ ring: local(e.geometry!, true), holes: [] });
    else if (e.type === 'relation') {
      const outers = (e.members ?? []).filter((m) => m.role === 'outer' && isClosed(m.geometry));
      const inners = (e.members ?? []).filter((m) => m.role === 'inner' && isClosed(m.geometry)).map((m) => local(m.geometry!, true));
      outers.forEach((m, i) => rings.push({ ring: local(m.geometry!, true), holes: i === 0 ? inners : [] }));
    }
    for (const { ring, holes } of rings) {
      if (ring.length < 6) continue;
      const area = ringArea(ring);
      if (area < 25) continue;
      const { h, min } = heights(k, t, area, opts.towerHeightM);
      const b: Building3D = { k, h: Math.round(h * 10) / 10, ring };
      if (min !== undefined && min > 0) b.min = Math.round(min * 10) / 10;
      if (holes.length) b.holes = holes.filter((x) => x.length >= 6);
      out.buildings.push(b);
      if (k === 'tower' && area < 2500) {
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < ring.length; i += 2) {
          cx += ring[i];
          cy += ring[i + 1];
        }
        cx /= ring.length / 2;
        cy /= ring.length / 2;
        // Eye height a few metres below the roof, inside the glass cab.
        out.towers.push({ x: Math.round(cx), y: Math.round(cy), h: Math.max(15, h - 4), r: Math.max(4, Math.sqrt(area / Math.PI)) });
      }
    }
  }
  // The tallest tower first (the main ATC tower is what the tower camera uses).
  out.towers.sort((x, y) => y.h - x.h);
  return out;
}

/** Convert local metres back to lat/lon around the origin (for rendering). */
export function toLatLon(origin: [number, number], x: number, y: number): { lat: number; lon: number } {
  const [lat, lon] = origin;
  const dLat = (y / 6_371_008.8) * (180 / Math.PI);
  const dLon = (x / (6_371_008.8 * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

/**
 * The airport's footprint as a convex outline (lat/lon ring): runways (with their approach ends), terminals, aprons,
 * taxiways and jet bridges, grown by `bufferM`. Used to keep photorealistic 3D only at the airport.
 */
export function airportArea(
  airport: { lat: number; lon: number; runways: { le: { lat: number; lon: number }; he: { lat: number; lon: number } }[] },
  data?: Airport3D | null,
  bufferM = 350,
): { lat: number; lon: number }[] {
  const origin: [number, number] = data?.origin ?? [airport.lat, airport.lon];
  const pts: [number, number][] = [];
  const addLocal = (x: number, y: number, r: number) => {
    for (let k = 0; k < 12; k++) pts.push([x + Math.cos((k * Math.PI) / 6) * r, y + Math.sin((k * Math.PI) / 6) * r]);
  };
  for (const r of airport.runways) {
    for (const e of [r.le, r.he]) {
      const o = enuOffsetM(origin[0], origin[1], e.lat, e.lon);
      addLocal(o.east, o.north, bufferM + 150);
    }
  }
  if (data) {
    const raw: [number, number][] = [];
    const ring = (flat: number[]) => {
      for (let i = 0; i + 1 < flat.length; i += 2) raw.push([flat[i], flat[i + 1]]);
    };
    for (const b of data.buildings) ring(b.ring);
    for (const a of data.aprons) ring(a);
    for (const t of data.taxiways) ring(t.line);
    for (const b of data.bridges) ring(b.line);
    for (const t of data.towers) raw.push([t.x, t.y]);
    // Ignore stray features far from the runways (mis-tagged buildings in town).
    for (const [x, y] of convexHull(raw)) if (Math.hypot(x, y) < 8000) addLocal(x, y, bufferM);
  }
  if (!pts.length) addLocal(0, 0, 2500);
  return convexHull(pts).map(([x, y]) => toLatLon(origin, x, y));
}

/** Andrew's monotone chain; returns the hull counter-clockwise without repeating the first point. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
