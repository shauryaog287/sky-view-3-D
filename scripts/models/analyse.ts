/**
 * Shape analysis for imported aircraft models (scripts/import-model.ts). Third-party models come as arbitrary meshes
 * in arbitrary axes; the app needs to know which way the nose points, and which vertices are fuselage, fin, winglets,
 * engine cowls and landing gear, so airline paint schemes and gear retraction work on them like on generated models.
 * Everything here is pure geometry on vertex arrays. No glTF types.
 */

export type V3 = [number, number, number];

export interface AxisGuess {
  /** Nose and top directions in the source axes (unit axis vectors). */
  fwd: V3;
  up: V3;
}

function bounds(pos: ArrayLike<number>): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

/**
 * Finds the nose and top directions of an aircraft point cloud.
 * Height is the smallest extent. Of the other two axes the wingspan is the one the model is mirror-symmetric along.
 * The tail is the end with the tall fin, and the fin points up.
 */
export function detectAxes(pos: ArrayLike<number>): AxisGuess {
  const { min, max } = bounds(pos);
  const ext = [0, 1, 2].map((k) => max[k] - min[k]);
  const upAxis = ext.indexOf(Math.min(...ext));
  const others = [0, 1, 2].filter((k) => k !== upAxis);
  const asym = others.map((k) => {
    const bins = new Float64Array(48);
    for (let i = 0; i < pos.length; i += 3) bins[Math.min(47, Math.floor(((pos[i + k] - min[k]) / (ext[k] || 1)) * 48))]++;
    let d = 0;
    let n = 0;
    for (let b = 0; b < 48; b++) {
      d += Math.abs(bins[b] - bins[47 - b]);
      n += bins[b];
    }
    return d / (n || 1);
  });
  const lenAxis = asym[0] > asym[1] ? others[0] : others[1];
  // End slabs along the length: the tail one is much taller (fin).
  const lo: number[] = [];
  const hi: number[] = [];
  const slab = 0.12 * ext[lenAxis];
  for (let i = 0; i < pos.length; i += 3) {
    const z = pos[i + lenAxis];
    if (z < min[lenAxis] + slab) lo.push(pos[i + upAxis]);
    else if (z > max[lenAxis] - slab) hi.push(pos[i + upAxis]);
  }
  const range = (a: number[]) => percentile(a, 0.995) - percentile(a, 0.005);
  const tailIsLo = range(lo) > range(hi);
  const tail = tailIsLo ? lo : hi;
  const nose = tailIsLo ? hi : lo;
  const mid = percentile(nose, 0.5);
  const upSign = percentile(tail, 0.995) - mid > mid - percentile(tail, 0.005) ? 1 : -1;
  const fwd: V3 = [0, 0, 0];
  const up: V3 = [0, 0, 0];
  fwd[lenAxis] = tailIsLo ? 1 : -1;
  up[upAxis] = upSign;
  return { fwd, up };
}

/** One triangle mesh in the app frame: X left, Y up, Z forward, metres, wheels on y = 0, centred in X and Z. */
export interface MeshIn {
  pos: Float32Array;
  nrm?: Float32Array;
  idx: Uint32Array;
}

export const ZONE = { TAIL: 1, ENGINE: 0.5, FUSELAGE: 0.25, NONE: 0 } as const;

export interface MeshZones {
  /**
   * Zones are constant per triangle, so vertices shared by triangles of different zones are split. `src` gives, for
   * every output vertex, the input vertex it copies; `idx` is the new index list (same triangle order as the input).
   */
  src: Uint32Array;
  idx: Uint32Array;
  /** Paint zone per output vertex (ZONE values). */
  zone: Float32Array;
  /** Per output vertex: [u along the fuselage, 0 tail … 1 nose; h height: fuselage −1 keel … +1 crown, fin 0 base … 1 top]. */
  paint: Float32Array;
  /** 1 for triangles that belong to the landing gear. */
  gearTri: Uint8Array;
}

export interface Analysis {
  meshes: MeshZones[];
  /** Fuselage radius, centreline height and crown height, m. */
  radius: number;
  axisY: number;
  topY: number;
  length: number;
  span: number;
  height: number;
  /** Triangle counts per zone. */
  counts: { fuselage: number; tail: number; engine: number; gearTris: number; nacelles: number };
}

interface Box {
  min: V3;
  max: V3;
}

/** Classifies every vertex of an aircraft (already in the app frame) into paint zones and finds the landing gear. */
export function analyse(meshes: MeshIn[]): Analysis {
  const all = { min: [Infinity, Infinity, Infinity] as V3, max: [-Infinity, -Infinity, -Infinity] as V3 };
  for (const m of meshes) {
    const b = bounds(m.pos);
    for (let k = 0; k < 3; k++) {
      all.min[k] = Math.min(all.min[k], b.min[k]);
      all.max[k] = Math.max(all.max[k], b.max[k]);
    }
  }
  const length = all.max[2] - all.min[2];
  const span = all.max[0] - all.min[0];
  const height = all.max[1] - all.min[1];
  const z0 = all.min[2];

  // Fuselage cross-section just behind the cockpit, where nothing else is attached.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const m of meshes) {
    for (let i = 0; i < m.pos.length; i += 3) {
      const t = (m.pos[i + 2] - z0) / length;
      if (t > 0.78 && t < 0.88) {
        xs.push(Math.abs(m.pos[i]));
        ys.push(m.pos[i + 1]);
      }
    }
  }
  const radius = percentile(xs, 0.99) || span * 0.055;
  const topY = percentile(ys, 0.99) || height * 0.45;
  const axisY = topY - radius;

  // Connected components (vertices welded by position across meshes): separate parts such as cowls and wheels.
  const key = new Map<string, number>();
  const parent: number[] = [];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const ids = meshes.map((m) => {
    const id = new Int32Array(m.pos.length / 3);
    for (let v = 0; v < id.length; v++) {
      const k = `${Math.round(m.pos[v * 3] * 400)},${Math.round(m.pos[v * 3 + 1] * 400)},${Math.round(m.pos[v * 3 + 2] * 400)}`;
      let n = key.get(k);
      if (n === undefined) {
        n = parent.length;
        parent.push(n);
        key.set(k, n);
      }
      id[v] = n;
    }
    for (let t = 0; t < m.idx.length; t += 3) {
      const a = find(id[m.idx[t]]);
      const b = find(id[m.idx[t + 1]]);
      const c = find(id[m.idx[t + 2]]);
      parent[b] = a;
      parent[find(c)] = a;
    }
    return id;
  });
  const boxes = new Map<number, Box>();
  meshes.forEach((m, mi) => {
    for (let v = 0; v < ids[mi].length; v++) {
      const c = find(ids[mi][v]);
      let b = boxes.get(c);
      if (!b) boxes.set(c, (b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
      for (let k = 0; k < 3; k++) {
        const p = m.pos[v * 3 + k];
        if (p < b.min[k]) b.min[k] = p;
        if (p > b.max[k]) b.max[k] = p;
      }
    }
  });

  // Engine cowls: compact, roughly round parts beside and below the fuselage axis, longer than wide.
  const nacelles: Box[] = [];
  for (const b of boxes.values()) {
    const dx = b.max[0] - b.min[0];
    const dy = b.max[1] - b.min[1];
    const dz = b.max[2] - b.min[2];
    const inner = Math.min(Math.abs(b.min[0]), Math.abs(b.max[0]));
    const oneSide = b.min[0] * b.max[0] > 0;
    const cy = (b.min[1] + b.max[1]) / 2;
    if (oneSide && inner > radius * 1.05 && dy > 0.6 * radius && dy < 1.6 * radius && dx / dy > 0.7 && dx / dy < 1.45 && dz > 0.9 * dy && dz < 3.6 * dy && cy < axisY) nacelles.push(b);
  }
  const grow = (b: Box, f: number): Box => {
    const o: Box = { min: [0, 0, 0], max: [0, 0, 0] };
    for (let k = 0; k < 3; k++) {
      const d = (b.max[k] - b.min[k]) * f;
      o.min[k] = b.min[k] - d;
      o.max[k] = b.max[k] + d;
    }
    return o;
  };
  const within = (b: Box, o: Box) => [0, 1, 2].every((k) => b.min[k] >= o.min[k] && b.max[k] <= o.max[k]);
  const nacelleZones = nacelles.map((b) => grow(b, 0.08));
  const kind = new Map<number, 'engine' | 'gear' | ''>();
  for (const [c, b] of boxes) {
    if (nacelleZones.some((n) => within(b, n))) kind.set(c, 'engine');
    else if (b.min[1] < 0.2 * radius && b.max[1] < axisY - 0.45 * radius && b.max[0] - b.min[0] < 0.25 * span) kind.set(c, 'gear');
    else kind.set(c, '');
  }

  // Wingtip level, to tell winglets (near-vertical surfaces rising above it) from the wing itself.
  const tipYs: number[] = [];
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) if (Math.abs(m.pos[i]) > 0.455 * span) tipYs.push(m.pos[i + 1]);
  const tipBase = percentile(tipYs, 0.15);
  const finTop = all.max[1];

  const counts = { fuselage: 0, tail: 0, engine: 0, gearTris: 0, nacelles: nacelles.length };
  const out = meshes.map((m, mi) => {
    const nTri = m.idx.length / 3;
    const gearTri = new Uint8Array(nTri);
    const src: number[] = [];
    const zone: number[] = [];
    const paint: number[] = [];
    const idx = new Uint32Array(m.idx.length);
    const slot = new Map<number, number>();
    for (let t = 0; t < nTri; t++) {
      const i0 = m.idx[t * 3];
      const i1 = m.idx[t * 3 + 1];
      const i2 = m.idx[t * 3 + 2];
      const P = (i: number, k: number) => m.pos[i * 3 + k];
      const cx = (P(i0, 0) + P(i1, 0) + P(i2, 0)) / 3;
      const cy = (P(i0, 1) + P(i1, 1) + P(i2, 1)) / 3;
      const cz = (P(i0, 2) + P(i1, 2) + P(i2, 2)) / 3;
      // Face normal.
      const ax = P(i1, 0) - P(i0, 0);
      const ay = P(i1, 1) - P(i0, 1);
      const az = P(i1, 2) - P(i0, 2);
      const bx = P(i2, 0) - P(i0, 0);
      const by = P(i2, 1) - P(i0, 1);
      const bz = P(i2, 2) - P(i0, 2);
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const u = (cz - z0) / length;
      const d = Math.hypot(cx, cy - axisY);
      const kinds = [i0, i1, i2].map((i) => kind.get(find(ids[mi][i])));
      let zn: number = ZONE.NONE;
      if (kinds.every((k) => k === 'gear')) {
        gearTri[t] = 1;
        counts.gearTris++;
      } else if (kinds.every((k) => k === 'engine')) zn = ZONE.ENGINE;
      else if (Math.abs(cx) < 0.45 * radius && cy > axisY + 1.02 * radius && u < 0.36) zn = ZONE.TAIL;
      else if (d <= 1.07 * radius) {
        // Fuselage skin faces outwards from the axis (or along it, at the nose and tail tips); wing and tailplane
        // roots inside the cylinder face up and down instead.
        const radial = d > 1e-6 ? Math.abs((nx * cx + ny * (cy - axisY)) / d) : 1;
        if (radial > 0.4 || (Math.abs(nz) > 0.75 && (u < 0.08 || u > 0.92))) zn = ZONE.FUSELAGE;
      } else if (Math.abs(cx) > 0.455 * span && cy > tipBase + 0.3 && Math.abs(nx) > 0.7) zn = ZONE.TAIL;
      if (zn === ZONE.FUSELAGE) counts.fuselage++;
      else if (zn === ZONE.TAIL) counts.tail++;
      else if (zn === ZONE.ENGINE) counts.engine++;
      const code = zn === ZONE.TAIL ? 3 : zn === ZONE.ENGINE ? 2 : zn === ZONE.FUSELAGE ? 1 : 0;
      [i0, i1, i2].forEach((i, c) => {
        const key2 = i * 4 + code;
        let o = slot.get(key2);
        if (o === undefined) {
          o = src.length;
          slot.set(key2, o);
          src.push(i);
          zone.push(zn);
          const y = P(i, 1);
          const uu = Math.min(1, Math.max(0, (P(i, 2) - z0) / length));
          let h = 0;
          if (zn === ZONE.TAIL && Math.abs(P(i, 0)) < radius) h = (y - topY) / Math.max(finTop - topY, 0.1);
          // Height relative to the fuselage axis of the constant section. The drooped nose and the upswept tail are
          // deliberately not followed: a belly colour then ends in a clean waterline, as on real aircraft.
          else if (zn === ZONE.FUSELAGE) h = (y - axisY) / radius;
          paint.push(uu, Math.min(1, Math.max(zn === ZONE.TAIL ? 0 : -1, h)));
        }
        idx[t * 3 + c] = o;
      });
    }
    return { src: Uint32Array.from(src), idx, zone: Float32Array.from(zone), paint: Float32Array.from(paint), gearTri };
  });
  return { meshes: out, radius, axisY, topY, length, span, height, counts };
}
