import { enuOffsetM } from './geo';

/**
 * 3D airport scenery from OpenStreetMap (© OpenStreetMap contributors, ODbL): terminals, hangars and other buildings
 * (with building parts, colours, roof shapes and materials where mapped), control towers, jet bridges, storage tanks,
 * masts, aircraft stands, runway centrelines, aprons, taxiways and the aerodrome boundary.
 * Compact format: coordinates are local east/north metres relative to the airport reference point.
 */
export type BuildingKind = 'terminal' | 'hangar' | 'tower' | 'building' | 'roof' | 'parking';
export type RoofShape = 'flat' | 'gabled' | 'hipped' | 'round' | 'skillion' | 'pyramidal' | 'dome';
export type WallMaterial = 'glass' | 'metal' | 'concrete' | 'brick';

export interface Building3D {
  k: BuildingKind;
  /** Roof height above ground, m. */
  h: number;
  /** Base height above ground (canopies, bridges, upper building parts), m. */
  min?: number;
  /** Outer ring as flat [x0, y0, x1, y1, …] east/north metres. */
  ring: number[];
  holes?: number[][];
  /** Wall and roof colours (rrggbb), when mapped. */
  c?: string;
  rc?: string;
  /** Roof shape and its height (part of h), when mapped. */
  rs?: RoofShape;
  rh?: number;
  m?: WallMaterial;
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
  v: 2;
  icao: string;
  origin: [number, number];
  generated: string;
  attribution: string;
  buildings: Building3D[];
  bridges: Bridge3D[];
  towers: Tower3D[];
  aprons: number[][];
  taxiways: { w: number; line: number[] }[];
  /** Runway centrelines as traced on imagery (designator like "10/28" when tagged). */
  runways?: { ref?: string; w: number; line: number[] }[];
  /** Aircraft parking positions, flat [x, y, …]. */
  stands?: number[];
  /** Fuel / water tanks. */
  tanks?: { x: number; y: number; r: number; h: number }[];
  /** Lighting masts and other tall thin structures. */
  masts?: { x: number; y: number; h: number }[];
  /** Aerodrome outline. */
  boundary?: number[];
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
  .ad;
  way(area.a)["aeroway"~"^(terminal|hangar|tower|control_tower|control_center|jet_bridge|apron|taxiway|taxilane|runway|parking_position)$"];
  way(area.a)["building"];
  way(area.a)["building:part"];
  way(area.a)["man_made"~"^(storage_tank|silo|mast|tower)$"];
  relation(area.a)["building"];
  relation(area.a)["aeroway"~"^(terminal|hangar|apron)$"];
  node(area.a)["aeroway"~"^(control_tower|parking_position)$"];
  node(area.a)["man_made"~"^(mast|tower|storage_tank)$"];
);
out geom;`;
}

/** Tags that matter for scenery (used to filter raw OSM extracts). */
export function isSceneryElement(t: Record<string, string> | undefined): boolean {
  if (!t) return false;
  if (t.aeroway && /^(aerodrome|terminal|hangar|tower|control_tower|control_center|jet_bridge|apron|taxiway|taxilane|runway|parking_position)$/.test(t.aeroway)) return true;
  if (t.building || t['building:part']) return true;
  return !!t.man_made && /^(storage_tank|silo|mast|tower)$/.test(t.man_made);
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(m|ft|')?/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] && m[2].toLowerCase() !== 'm' ? n * 0.3048 : n;
}

const NAMED: Record<string, string> = {
  white: 'ffffff', black: '1a1a1a', grey: '9a9a9a', gray: '9a9a9a', silver: 'c0c0c0', red: 'b03a2e', brown: '7b5b43', beige: 'd9cdb4',
  yellow: 'e3c84a', blue: '3d6ea8', green: '4f8a55', orange: 'd9822b', cream: 'efe7d0', tan: 'c9b08a', maroon: '6b1f2a', lightgrey: 'cfcfcf',
  lightgray: 'cfcfcf', darkgrey: '5a5a5a', darkgray: '5a5a5a', lightblue: '9fc3e0', glass: '7fa3c0',
};
/** OSM colour value → rrggbb. */
export function colour(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^#[0-9a-f]{6}$/.test(s)) return s.slice(1);
  if (/^#[0-9a-f]{3}$/.test(s)) return [...s.slice(1)].map((c) => c + c).join('');
  return NAMED[s];
}

function material(t: Record<string, string>): WallMaterial | undefined {
  const m = (t['building:material'] ?? t['building:facade:material'] ?? t['building:cladding'] ?? '').toLowerCase();
  if (/glass/.test(m)) return 'glass';
  if (/metal|steel|alumin|tin|zinc/.test(m)) return 'metal';
  if (/brick/.test(m)) return 'brick';
  if (/concrete|cement|plaster|stone/.test(m)) return 'concrete';
  return undefined;
}

const ROOFS: Record<string, RoofShape> = {
  flat: 'flat', gabled: 'gabled', hipped: 'hipped', round: 'round', skillion: 'skillion', pyramidal: 'pyramidal', dome: 'dome',
  'half-hipped': 'hipped', gambrel: 'gabled', saltbox: 'gabled', mansard: 'hipped', onion: 'dome', barrel: 'round', arched: 'round',
};

function kindOf(t: Record<string, string>): BuildingKind | undefined {
  const a = t.aeroway;
  const b = t.building ?? t['building:part'];
  if (a === 'tower' || a === 'control_tower' || (t.man_made === 'tower' && /air_traffic|control/.test(t['tower:type'] ?? ''))) return 'tower';
  if (a === 'terminal' || b === 'terminal' || b === 'airport_terminal') return 'terminal';
  if (a === 'hangar' || b === 'hangar') return 'hangar';
  if (b === 'roof' || t['building:part'] === 'roof') return 'roof';
  if (b === 'parking' || t.amenity === 'parking') return 'parking';
  if (b || a === 'control_center') return 'building';
  return undefined;
}

/** Heights: tagged height, else levels, else sensible defaults per kind. */
function heights(k: BuildingKind, t: Record<string, string>, areaM2: number, towerHeightM?: number): { h: number; min?: number } {
  const tagged = num(t.height) ?? num(t['building:height']);
  // Control towers: OSM levels usually count only the cab, so prefer an explicit height, then the curated value.
  if (k === 'tower' && areaM2 < 2500) return { h: tagged ?? towerHeightM ?? 50 };
  const levels = num(t['building:levels']);
  const min = num(t.min_height) ?? (num(t['building:min_level']) !== undefined ? num(t['building:min_level'])! * 3.5 : undefined);
  const perLevel = k === 'terminal' ? 5.5 : 3.5;
  let h = tagged ?? (levels !== undefined ? levels * perLevel + 2 + (min ?? 0) : undefined);
  if (h === undefined) {
    h =
      k === 'terminal' ? (areaM2 > 20_000 ? 28 : 18)
      : k === 'hangar' ? (areaM2 > 8000 ? 24 : 15)
      : k === 'tower' ? (areaM2 < 2500 ? 45 : 18)
      : k === 'roof' ? 9
      : k === 'parking' ? 12
      : areaM2 > 5000 ? 12 : 8;
    if (min !== undefined) h += min;
  }
  if (k === 'roof') return { h: Math.max(h, 6), min: min ?? Math.max(4, h - 1.5) };
  return { h: Math.max(3, h, (min ?? 0) + 2.5), min };
}

function ringArea(r: number[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return Math.abs(a / 2);
}

function centroid(r: number[]): [number, number] {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length; i += 2) {
    cx += r[i];
    cy += r[i + 1];
  }
  return [cx / (r.length / 2), cy / (r.length / 2)];
}

/** Point in a flat [x, y, …] ring. */
export function inRing(r: number[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  }
  return c;
}

/** Join multipolygon member ways that share end nodes into closed rings (closed members pass through). */
export function joinRings(geoms: OsmLatLon[][]): OsmLatLon[][] {
  const same = (a: OsmLatLon, b: OsmLatLon) => a.lat === b.lat && a.lon === b.lon;
  const closed: OsmLatLon[][] = [];
  const open: OsmLatLon[][] = [];
  for (const g of geoms) {
    if (g.length < 2) continue;
    if (g.length > 3 && same(g[0], g[g.length - 1])) closed.push(g);
    else open.push([...g]);
  }
  while (open.length) {
    let cur = open.pop()!;
    let grew = true;
    while (grew && !same(cur[0], cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        const tail = cur[cur.length - 1];
        if (same(o[0], tail)) cur = cur.concat(o.slice(1));
        else if (same(o[o.length - 1], tail)) cur = cur.concat([...o].reverse().slice(1));
        else if (same(o[o.length - 1], cur[0])) cur = o.concat(cur.slice(1));
        else if (same(o[0], cur[0])) cur = [...o].reverse().concat(cur.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length > 3 && same(cur[0], cur[cur.length - 1])) closed.push(cur);
  }
  return closed;
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
    v: 2,
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
  const runways: NonNullable<Airport3D['runways']> = [];
  const stands: number[] = [];
  const tanks: NonNullable<Airport3D['tanks']> = [];
  const masts: NonNullable<Airport3D['masts']> = [];
  const isClosed = (g?: OsmLatLon[]) => !!g && g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  const outlines: (Building3D & { area: number })[] = [];
  const parts: (Building3D & { area: number })[] = [];

  for (const e of elements) {
    const t = e.tags ?? {};
    const a = t.aeroway;
    if (e.type === 'node') {
      if (e.lat === undefined || e.lon === undefined) continue;
      const o = enuOffsetM(oLat, oLon, e.lat, e.lon);
      const x = Math.round(o.east);
      const y = Math.round(o.north);
      if (a === 'control_tower') out.towers.push({ x, y, h: (num(t.height) ?? opts.towerHeightM ?? 50) - 4, r: 8 });
      else if (a === 'parking_position') stands.push(x, y);
      else if (t.man_made === 'mast' || (t.man_made === 'tower' && !/air_traffic|control/.test(t['tower:type'] ?? ''))) masts.push({ x, y, h: Math.round(num(t.height) ?? 30) });
      else if (t.man_made === 'storage_tank') tanks.push({ x, y, r: 6, h: Math.round(num(t.height) ?? 10) });
      continue;
    }
    if (a === 'aerodrome') {
      const g =
        e.type === 'way'
          ? e.geometry
          : joinRings((e.members ?? []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry!)).sort((p, q) => q.length - p.length)[0];
      if (g && g.length > 3) {
        const ring = local(g, true, 8);
        if (ring.length >= 6 && (!out.boundary || ringArea(ring) > ringArea(out.boundary))) out.boundary = ring.map((v) => Math.round(v));
      }
      continue;
    }
    if (e.type === 'way' && a === 'runway' && e.geometry && e.geometry.length >= 2 && !isClosed(e.geometry)) {
      const line = local(e.geometry, false, 1);
      if (line.length >= 4) runways.push({ ...(t.ref ? { ref: t.ref } : {}), w: Math.round(num(t.width) ?? 45), line });
      continue;
    }
    if (e.type === 'way' && (a === 'taxiway' || a === 'taxilane') && e.geometry && !isClosed(e.geometry)) {
      out.taxiways.push({ w: num(t.width) ?? (a === 'taxilane' ? 15 : 23), line: local(e.geometry, false, 1.5) });
      continue;
    }
    if (e.type === 'way' && a === 'parking_position' && e.geometry?.length) {
      // Stand lead-in line: the stop position is its end nearest the terminal; take the midpoint as the stand.
      const g = e.geometry;
      const mid = enuOffsetM(oLat, oLon, (g[0].lat + g[g.length - 1].lat) / 2, (g[0].lon + g[g.length - 1].lon) / 2);
      stands.push(Math.round(mid.east), Math.round(mid.north));
      continue;
    }
    if (e.type === 'way' && a === 'jet_bridge' && e.geometry) {
      const line = local(e.geometry, false, 0.3);
      if (line.length >= 4) out.bridges.push({ line, w: num(t.width) ?? 3.6 });
      continue;
    }
    if (a === 'apron') {
      if (e.type === 'way' && isClosed(e.geometry)) out.aprons.push(local(e.geometry!, true, 1.5));
      else for (const g of joinRings((e.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry!))) out.aprons.push(local(g, true, 1.5));
      continue;
    }
    if (e.type === 'way' && (t.man_made === 'storage_tank' || t.man_made === 'silo' || t.building === 'storage_tank') && isClosed(e.geometry)) {
      const ring = local(e.geometry!, true, 0.5);
      const area = ringArea(ring);
      if (area > 12 && area < 12_000) {
        const [cx, cy] = centroid(ring);
        const r = Math.sqrt(area / Math.PI);
        tanks.push({ x: Math.round(cx), y: Math.round(cy), r: Math.round(r * 10) / 10, h: Math.round(num(t.height) ?? Math.min(20, Math.max(6, r * 0.9))) });
        continue;
      }
    }
    if (e.type === 'way' && (t.man_made === 'mast' || (t.man_made === 'tower' && !/air_traffic|control/.test(t['tower:type'] ?? '') && !t.building)) && e.geometry?.length) {
      const c = enuOffsetM(oLat, oLon, e.geometry[0].lat, e.geometry[0].lon);
      masts.push({ x: Math.round(c.east), y: Math.round(c.north), h: Math.round(num(t.height) ?? 30) });
      continue;
    }
    const k = kindOf(t);
    if (!k) continue;
    const isPart = !!t['building:part'] && !t.building && !a;
    const rings: { ring: number[]; holes: number[][] }[] = [];
    if (e.type === 'way' && isClosed(e.geometry)) rings.push({ ring: local(e.geometry!, true), holes: [] });
    else if (e.type === 'relation') {
      const outers = joinRings((e.members ?? []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry!)).map((g) => local(g, true));
      const inners = joinRings((e.members ?? []).filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry!)).map((g) => local(g, true));
      // Each hole belongs to the outer ring that contains it.
      outers.forEach((ring) => rings.push({ ring, holes: inners.filter((h) => inRing(ring, h[0], h[1])) }));
    }
    for (const { ring, holes } of rings) {
      if (ring.length < 6) continue;
      const area = ringArea(ring);
      if (area < 25) continue;
      const { h, min } = heights(k, t, area, opts.towerHeightM);
      const b: Building3D & { area: number } = { k, h: Math.round(h * 10) / 10, ring, area };
      if (min !== undefined && min > 0) b.min = Math.round(min * 10) / 10;
      if (holes.length) b.holes = holes.filter((x) => x.length >= 6);
      const c = colour(t['building:colour'] ?? t['building:color']);
      const rc = colour(t['roof:colour'] ?? t['roof:color']);
      const rs = ROOFS[(t['roof:shape'] ?? '').toLowerCase()];
      const rh = num(t['roof:height']) ?? (num(t['roof:levels']) !== undefined ? num(t['roof:levels'])! * 3 : undefined);
      const m = material(t);
      if (c) b.c = c;
      if (rc) b.rc = rc;
      if (rs && rs !== 'flat') b.rs = rs;
      if (rh && rh > 0.5) b.rh = Math.round(Math.min(rh, h * 0.8) * 10) / 10;
      if (m) b.m = m;
      (isPart ? parts : outlines).push(b);
      if (k === 'tower' && area < 2500 && !isPart) {
        const [cx, cy] = centroid(ring);
        // Eye height a few metres below the roof, inside the glass cab.
        out.towers.push({ x: Math.round(cx), y: Math.round(cy), h: Math.max(15, h - 4), r: Math.max(4, Math.sqrt(area / Math.PI)) });
      }
    }
  }
  // Simple 3D Buildings: where building parts cover an outline, draw the parts instead of the outline.
  for (const o of outlines) {
    let covered = 0;
    for (const p of parts) {
      const [cx, cy] = centroid(p.ring);
      if (inRing(o.ring, cx, cy)) covered += p.area;
    }
    if (covered < o.area * 0.5) out.buildings.push(strip(o));
  }
  for (const p of parts) out.buildings.push(strip(p));
  if (runways.length) out.runways = runways;
  if (stands.length) out.stands = stands;
  if (tanks.length) out.tanks = tanks;
  if (masts.length) out.masts = masts;
  // The tallest tower first (the main ATC tower is what the tower camera uses).
  out.towers.sort((x, y) => y.h - x.h);
  return out;
}

function strip(b: Building3D & { area?: number }): Building3D {
  const { area: _area, ...rest } = b;
  return rest;
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
