/**
 * Turns an airport's compact scenery data into one triangle mesh with everything the facade shader needs:
 * glazed terminals, buildings with window grids, arched and gabled hangars, canopies on posts, multi-storey car
 * parks, control towers with a glass cab, jet bridges on pillars with a rotunda, storage tanks and lighting masts.
 * Pure geometry (no Cesium): positions are local metres, x east, y north, z up from the airfield surface.
 */
import earcut from 'earcut';
import type { Airport3D, Building3D } from './airport3d';
import { convexHull } from './airport3d';

/** Material ids understood by the facade shader (src/scene/airportAppearance.ts). */
export const MAT = { WALL: 0, GLASS: 1, METAL: 2, ROOF: 3, ROOF_METAL: 4, PLAIN: 5, CAB: 6, BRIDGE: 7, PARKING: 8 } as const;

export interface AirportMesh {
  position: Float32Array;
  normal: Float32Array;
  /** Metres: walls (along the wall, above ground); roofs (east, north). */
  uv: Float32Array;
  /** Base colour, rgb 0–255. */
  color: Uint8Array;
  /** Per vertex: material id, a per-building random 0–1, and the wall's top height (m). */
  mat: Float32Array;
  index: Uint32Array;
  /** Tops of tall structures (for obstruction lights): x, y, z. */
  tops: { x: number; y: number; z: number }[];
}

type RGB = [number, number, number];
const WALLS: RGB[] = [[226, 221, 208], [208, 210, 212], [232, 232, 228], [203, 193, 178], [190, 198, 205], [214, 205, 190]];
const ROOFS: RGB[] = [[150, 152, 155], [170, 170, 168], [128, 132, 138], [186, 184, 178]];
const HANGAR_WALLS: RGB[] = [[205, 210, 214], [188, 198, 208], [222, 220, 212], [176, 186, 196]];
const HANGAR_ROOFS: RGB[] = [[172, 178, 184], [150, 160, 172], [196, 198, 200]];
const TERMINAL_GLASS: RGB = [118, 160, 190];
const TERMINAL_ROOF: RGB = [226, 228, 230];
const CONCRETE: RGB = [206, 204, 198];
const STEEL: RGB = [150, 155, 162];
const WHITE: RGB = [236, 236, 234];

const hex = (c: string): RGB => [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
/** Deterministic 0–1 from a position (stable look for a building between sessions). */
const rand = (x: number, y: number, k = 0) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

class Mesh {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  c: number[] = [];
  m: number[] = [];
  i: number[] = [];
  tops: AirportMesh['tops'] = [];

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: RGB, mat: number, seed: number, top: number): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    this.c.push(col[0], col[1], col[2]);
    this.m.push(mat, seed, top);
    return this.p.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number) {
    this.i.push(a, b, c, a, c, d);
  }

  /** Vertical walls around a ring (counter-clockwise = facing out), from z0 to z1. */
  walls(ring: number[], z0: number, z1: number, col: RGB, mat: number, seed: number, inward = false) {
    const n = ring.length / 2;
    let along = 0;
    for (let k = 0; k < n; k++) {
      const x0 = ring[k * 2];
      const y0 = ring[k * 2 + 1];
      const x1 = ring[((k + 1) % n) * 2];
      const y1 = ring[((k + 1) % n) * 2 + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.05) continue;
      let nx = (y1 - y0) / len;
      let ny = -(x1 - x0) / len;
      if (inward) {
        nx = -nx;
        ny = -ny;
      }
      const a = this.vert(x0, y0, z0, nx, ny, 0, along, z0, col, mat, seed, z1);
      const b = this.vert(x1, y1, z0, nx, ny, 0, along + len, z0, col, mat, seed, z1);
      const c = this.vert(x1, y1, z1, nx, ny, 0, along + len, z1, col, mat, seed, z1);
      const d = this.vert(x0, y0, z1, nx, ny, 0, along, z1, col, mat, seed, z1);
      if (inward) this.quad(a, d, c, b);
      else this.quad(a, b, c, d);
      along += len;
    }
  }

  /** Horizontal polygon (with holes) at height z, facing up or down. */
  cap(ring: number[], holes: number[][], z: number, col: RGB, mat: number, seed: number, up = true) {
    const flat = [...ring];
    const holeIdx: number[] = [];
    for (const h of holes) {
      holeIdx.push(flat.length / 2);
      flat.push(...h);
    }
    const tris = earcut(flat, holeIdx.length ? holeIdx : null, 2);
    const base = this.p.length / 3;
    for (let k = 0; k < flat.length; k += 2) this.vert(flat[k], flat[k + 1], z, 0, 0, up ? 1 : -1, flat[k], flat[k + 1], col, mat, seed, z);
    for (let k = 0; k < tris.length; k += 3) {
      // earcut keeps the input winding; rings are counter-clockwise, i.e. facing up.
      if (up) this.i.push(base + tris[k], base + tris[k + 1], base + tris[k + 2]);
      else this.i.push(base + tris[k], base + tris[k + 2], base + tris[k + 1]);
    }
  }

  /** Surface of revolution around a vertical axis: profile points [z, radius], smooth shading. */
  lathe(cx: number, cy: number, profile: [number, number][], seg: number, col: RGB, mat: number, seed: number, top: number, capTop = true) {
    const base = this.p.length / 3;
    const ring = seg + 1;
    for (let k = 0; k < profile.length; k++) {
      const [z, r] = profile[k];
      const prev = profile[Math.max(0, k - 1)];
      const next = profile[Math.min(profile.length - 1, k + 1)];
      const dz = next[0] - prev[0];
      const slope = Math.abs(dz) < 1e-6 ? 0 : -(next[1] - prev[1]) / dz;
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const l = Math.hypot(1, slope);
        this.vert(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, Math.cos(a) / l, Math.sin(a) / l, slope / l, (s / seg) * Math.PI * 2 * Math.max(r, 0.5), z, col, mat, seed, top);
      }
    }
    for (let k = 0; k < profile.length - 1; k++) {
      for (let s = 0; s < seg; s++) {
        const a = base + k * ring + s;
        this.quad(a, a + 1, a + ring + 1, a + ring);
      }
    }
    if (capTop) {
      const [z, r] = profile[profile.length - 1];
      if (r > 0.05) {
        const c = this.vert(cx, cy, z, 0, 0, 1, cx, cy, col, MAT.PLAIN, seed, top);
        const b2 = this.p.length / 3;
        for (let s = 0; s <= seg; s++) {
          const a = (s / seg) * Math.PI * 2;
          this.vert(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, 0, 0, 1, 0, 0, col, MAT.PLAIN, seed, top);
        }
        for (let s = 0; s < seg; s++) this.i.push(c, b2 + s, b2 + s + 1);
      }
    }
  }

  /** Axis-aligned-to-direction box: centre line from (x0,y0) to (x1,y1), width w, between z0 and z1. */
  beam(x0: number, y0: number, x1: number, y1: number, w: number, z0: number, z1: number, col: RGB, mat: number, seed: number, roof: RGB = col) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.05) return;
    const dx = (x1 - x0) / len;
    const dy = (y1 - y0) / len;
    const px = (-dy * w) / 2;
    const py = (dx * w) / 2;
    // Counter-clockwise footprint.
    const ring = [x0 - px, y0 - py, x1 - px, y1 - py, x1 + px, y1 + py, x0 + px, y0 + py];
    this.walls(ring, z0, z1, col, mat, seed);
    this.cap(ring, [], z1, roof, MAT.PLAIN, seed, true);
    if (z0 > 0.2) this.cap(ring, [], z0, col, MAT.PLAIN, seed, false);
  }

  build(): AirportMesh {
    return {
      position: Float32Array.from(this.p),
      normal: Float32Array.from(this.n),
      uv: Float32Array.from(this.uv),
      color: Uint8Array.from(this.c),
      mat: Float32Array.from(this.m),
      index: Uint32Array.from(this.i),
      tops: this.tops,
    };
  }
}

function signedArea(r: number[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a / 2;
}
const ccw = (r: number[]): number[] => {
  if (signedArea(r) >= 0) return r;
  const out: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i], r[i + 1]);
  return out;
};
const cw = (r: number[]): number[] => {
  const c = ccw(r);
  const out: number[] = [];
  for (let i = c.length - 2; i >= 0; i -= 2) out.push(c[i], c[i + 1]);
  return out;
};

/** Minimum-area bounding rectangle: centre, unit long axis, half length and half width. */
export function orientedBox(ring: number[]): { cx: number; cy: number; ax: number; ay: number; hl: number; hw: number; area: number } {
  const pts: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  const hull = convexHull(pts);
  let best = { cx: 0, cy: 0, ax: 1, ay: 0, hl: 0, hw: 0, area: Infinity };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const long = maxU - minU >= maxV - minV;
      best = {
        cx: cu * ux - cv * uy,
        cy: cu * uy + cv * ux,
        ax: long ? ux : -uy,
        ay: long ? uy : ux,
        hl: Math.max(maxU - minU, maxV - minV) / 2,
        hw: Math.min(maxU - minU, maxV - minV) / 2,
        area,
      };
    }
  }
  return best;
}

/** Arched ('round') or pitched ('gabled') roof over a rectangular footprint, with the end walls filled in. */
function shapedRoof(m: Mesh, box: ReturnType<typeof orientedBox>, eave: number, rise: number, round: boolean, wall: RGB, roof: RGB, wallMat: number, seed: number) {
  const { cx, cy, ax, ay, hl, hw } = box;
  const px = -ay;
  const py = ax;
  const steps = round ? 10 : 2;
  // Cross-section across the short axis: t in [-1, 1] → (offset, height).
  const section: [number, number][] = [];
  for (let s = 0; s <= steps; s++) {
    const t = -1 + (2 * s) / steps;
    section.push([t * hw, eave + (round ? Math.sqrt(Math.max(0, 1 - t * t)) * rise : (1 - Math.abs(t)) * rise)]);
  }
  const top = eave + rise;
  const at = (l: number, o: number): [number, number] => [cx + ax * l + px * o, cy + ay * l + py * o];
  // Roof surface.
  for (let s = 0; s < steps; s++) {
    const [o0, z0] = section[s];
    const [o1, z1] = section[s + 1];
    const run = Math.hypot(o1 - o0, z1 - z0) || 1;
    const nz = (o1 - o0) / run;
    const no = -(z1 - z0) / run;
    const nx = px * no;
    const ny = py * no;
    const a = at(-hl, o0);
    const b = at(hl, o0);
    const c = at(hl, o1);
    const d = at(-hl, o1);
    const i0 = m.vert(a[0], a[1], z0, nx, ny, nz, 0, o0, roof, MAT.ROOF_METAL, seed, top);
    const i1 = m.vert(b[0], b[1], z0, nx, ny, nz, hl * 2, o0, roof, MAT.ROOF_METAL, seed, top);
    const i2 = m.vert(c[0], c[1], z1, nx, ny, nz, hl * 2, o1, roof, MAT.ROOF_METAL, seed, top);
    const i3 = m.vert(d[0], d[1], z1, nx, ny, nz, 0, o1, roof, MAT.ROOF_METAL, seed, top);
    m.quad(i0, i1, i2, i3);
  }
  // Side walls up to the eave, and the two end walls up to the roof line.
  const ring = [...at(-hl, -hw), ...at(hl, -hw), ...at(hl, hw), ...at(-hl, hw)];
  m.walls(ccw(ring), 0, eave, wall, wallMat, seed);
  for (const end of [-1, 1]) {
    const nx = ax * end;
    const ny = ay * end;
    const c0 = at(end * hl, 0);
    const centre = m.vert(c0[0], c0[1], eave, nx, ny, 0, hw, eave, wall, wallMat, seed, top);
    const ids = section.map(([o, z]) => {
      const q = at(end * hl, o);
      return m.vert(q[0], q[1], z, nx, ny, 0, o + hw, z, wall, wallMat, seed, top);
    });
    for (let s = 0; s < steps; s++) {
      if (end > 0) m.i.push(centre, ids[s], ids[s + 1]);
      else m.i.push(centre, ids[s + 1], ids[s]);
    }
  }
}

function building(m: Mesh, b: Building3D) {
  const ring = ccw(b.ring);
  const holes = (b.holes ?? []).map(cw);
  const seed = rand(ring[0], ring[1]);
  const pick = <T>(arr: T[], k = 1) => arr[Math.floor(rand(ring[0], ring[1], k) * arr.length) % arr.length];
  const z0 = b.min ?? 0;
  const area = Math.abs(signedArea(ring));
  let wall: RGB;
  let roof: RGB;
  let wallMat: number = MAT.WALL;
  let roofMat: number = MAT.ROOF;
  switch (b.k) {
    case 'terminal':
      wall = TERMINAL_GLASS;
      roof = TERMINAL_ROOF;
      wallMat = MAT.GLASS;
      break;
    case 'hangar':
      wall = pick(HANGAR_WALLS);
      roof = pick(HANGAR_ROOFS, 2);
      wallMat = MAT.METAL;
      roofMat = MAT.ROOF_METAL;
      break;
    case 'roof':
      wall = STEEL;
      roof = pick(HANGAR_ROOFS, 2);
      wallMat = MAT.PLAIN;
      roofMat = MAT.ROOF_METAL;
      break;
    case 'parking':
      wall = CONCRETE;
      roof = pick(ROOFS, 2);
      wallMat = MAT.PARKING;
      break;
    case 'tower':
      wall = CONCRETE;
      roof = pick(ROOFS, 2);
      break;
    default:
      wall = pick(WALLS);
      roof = pick(ROOFS, 2);
      // Large modern blocks read as offices: glazed.
      if (area > 4000 && b.h >= 14 && seed > 0.45) {
        wall = [128, 158, 182];
        wallMat = MAT.GLASS;
      } else if (area > 2500 && b.h < 14 && seed > 0.5) {
        wall = pick(HANGAR_WALLS);
        wallMat = MAT.METAL;
        roofMat = MAT.ROOF_METAL;
      }
  }
  if (b.m === 'glass') wallMat = MAT.GLASS;
  else if (b.m === 'metal') wallMat = MAT.METAL;
  else if (b.m === 'concrete' || b.m === 'brick') wallMat = b.k === 'parking' ? MAT.PARKING : MAT.WALL;
  if (b.c) wall = hex(b.c);
  if (b.rc) roof = hex(b.rc);

  if (b.k === 'roof') {
    // Canopy: a thin slab on posts.
    const slab = Math.max(z0, b.h - 0.6);
    m.walls(ring, slab, b.h, roof, MAT.PLAIN, seed);
    m.cap(ring, holes, b.h, roof, roofMat, seed, true);
    m.cap(ring, holes, slab, wall, MAT.PLAIN, seed, false);
    const n = ring.length / 2;
    const stride = Math.max(1, Math.ceil(n / 10));
    for (let k = 0; k < n; k += stride) m.beam(ring[k * 2] - 0.2, ring[k * 2 + 1], ring[k * 2] + 0.2, ring[k * 2 + 1], 0.4, 0, slab, STEEL, MAT.PLAIN, seed);
    return;
  }

  // Arched / pitched roofs: mapped shapes, and by default for hangars with a roughly rectangular footprint.
  const shape = b.rs ?? (b.k === 'hangar' ? (seed > 0.4 ? 'round' : 'gabled') : undefined);
  if ((shape === 'round' || shape === 'gabled') && !holes.length && z0 === 0) {
    const box = orientedBox(ring);
    if (box.area > 0 && area / box.area > 0.8 && box.hw > 3) {
      const rise = Math.min(b.rh ?? (shape === 'round' ? box.hw * 0.3 : box.hw * 0.22), b.h * 0.45, 9);
      shapedRoof(m, box, b.h - rise, rise, shape === 'round', wall, roof, wallMat, seed);
      return;
    }
  }
  m.walls(ring, z0, b.h, wall, wallMat, seed);
  for (const h of holes) m.walls(h, z0, b.h, wall, wallMat, seed);
  m.cap(ring, holes, b.h, roof, roofMat, seed, true);
  if (z0 > 0.5) m.cap(ring, holes, z0, wall, MAT.PLAIN, seed, false);
  if (b.h > 45) {
    const [x, y] = [ring[0], ring[1]];
    m.tops.push({ x, y, z: b.h });
  }
}

function tower(m: Mesh, t: { x: number; y: number; h: number; r: number }) {
  const seed = rand(t.x, t.y);
  const r = Math.min(Math.max(t.r, 4), 9);
  const eye = t.h;
  const neck = Math.max(8, eye - 4.5);
  // Concrete shaft with a flared collar under the cab.
  m.lathe(t.x, t.y, [[0, r * 0.62], [neck * 0.5, r * 0.5], [neck - 3, r * 0.48], [neck, r * 0.95], [neck + 1.6, r * 1.05]], 14, CONCRETE, MAT.PLAIN, seed, neck + 1.6, false);
  // Glass cab leaning outwards, then the roof with an overhang and an antenna.
  m.lathe(t.x, t.y, [[neck + 1.6, r * 1.02], [eye + 2.4, r * 1.3]], 14, [70, 96, 110], MAT.CAB, seed, eye + 2.4, false);
  m.lathe(t.x, t.y, [[eye + 2.4, r * 1.42], [eye + 3.1, r * 1.36], [eye + 3.5, r * 0.5]], 14, WHITE, MAT.PLAIN, seed, eye + 3.5, true);
  m.lathe(t.x, t.y, [[eye + 3.5, 0.18], [eye + 9, 0.08]], 5, STEEL, MAT.PLAIN, seed, eye + 9, true);
  m.tops.push({ x: t.x, y: t.y, z: eye + 9.2 });
}

function bridge(m: Mesh, line: number[], w: number) {
  const seed = rand(line[0], line[1]);
  const z0 = 3.7;
  const z1 = 6.5;
  const n = line.length / 2;
  let total = 0;
  for (let k = 0; k < n - 1; k++) total += Math.hypot(line[k * 2 + 2] - line[k * 2], line[k * 2 + 3] - line[k * 2 + 1]);
  let walked = 0;
  let pillar = false;
  for (let k = 0; k < n - 1; k++) {
    const x0 = line[k * 2];
    const y0 = line[k * 2 + 1];
    const x1 = line[k * 2 + 2];
    const y1 = line[k * 2 + 3];
    const len = Math.hypot(x1 - x0, y1 - y0);
    m.beam(x0, y0, x1, y1, w, z0, z1, [218, 222, 226], MAT.BRIDGE, seed, [200, 203, 208]);
    // One support (the wheeled drive column) about 70 % of the way to the aircraft.
    if (!pillar && walked + len >= total * 0.7) {
      const t = Math.min(1, Math.max(0, (total * 0.7 - walked) / (len || 1)));
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      m.beam(px - 0.45, py, px + 0.45, py, 0.9, 0, z0, STEEL, MAT.PLAIN, seed);
      m.beam(px - 1.6, py, px + 1.6, py, 1.2, 0, 0.9, [60, 62, 66], MAT.PLAIN, seed);
      pillar = true;
    }
    walked += len;
  }
  // Rotunda where the bridge leaves the terminal.
  m.lathe(line[0], line[1], [[0, 0.9], [z0 - 0.4, 0.9], [z0 - 0.4, w * 0.75], [z1 + 0.3, w * 0.75]], 10, [210, 214, 218], MAT.PLAIN, seed, z1 + 0.3, true);
}

export function buildAirportMesh(a: Airport3D): AirportMesh {
  const m = new Mesh();
  const hasTowers = a.towers.length > 0;
  for (const b of a.buildings) {
    if (b.k === 'tower' && hasTowers) continue; // drawn as shaft + glass cab below
    if (b.ring.length < 6) continue;
    building(m, b);
  }
  for (const t of a.towers.slice(0, 3)) tower(m, t);
  for (const br of a.bridges) if (br.line.length >= 4) bridge(m, br.line, Math.max(2.6, Math.min(br.w, 5)));
  for (const t of a.tanks ?? []) {
    const seed = rand(t.x, t.y);
    m.lathe(t.x, t.y, [[0, t.r], [t.h, t.r], [t.h + t.r * 0.18, t.r * 0.55], [t.h + t.r * 0.25, 0.05]], 16, WHITE, MAT.PLAIN, seed, t.h, true);
  }
  for (const s of a.masts ?? []) {
    const seed = rand(s.x, s.y);
    const h = Math.min(Math.max(s.h, 12), 60);
    m.lathe(s.x, s.y, [[0, 0.45], [h, 0.22]], 6, STEEL, MAT.PLAIN, seed, h, true);
    m.beam(s.x - 1.6, s.y, s.x + 1.6, s.y, 0.5, h - 0.2, h + 1.0, [90, 94, 100], MAT.PLAIN, seed);
    m.tops.push({ x: s.x, y: s.y, z: h + 1.2 });
  }
  return m.build();
}
