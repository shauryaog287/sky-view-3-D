/**
 * Generates the low-poly aircraft models in public/models/*.glb (original work, CC0).
 *
 *   npm run data:models
 *
 * Why generated: we need small, mobile-friendly glTF models per class with an unambiguous licence. Building them
 * from parametric shapes (lathe fuselage, tapered wings, nacelles, rotors) gives us exactly that.
 * Swap in higher-detail CC-BY models later by dropping .glb files with the same names and recording them in
 * ASSETS_LICENSES.md.
 *
 * Coordinate system (glTF): +Y up, +Z forward (nose), ±X wings. Units: metres. Origin at ground level under the
 * fuselage centre, so an aircraft on the ground sits on its wheels.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type V3 = [number, number, number];

interface MeshPart {
  positions: number[];
  normals: number[];
  indices: number[];
}

class Builder {
  parts = new Map<string, MeshPart>();
  part(material: string): MeshPart {
    let p = this.parts.get(material);
    if (!p) this.parts.set(material, (p = { positions: [], normals: [], indices: [] }));
    return p;
  }

  /** Flat-shaded triangle fan of a convex polygon (vertices in CCW order seen from outside). */
  poly(material: string, pts: V3[]) {
    const p = this.part(material);
    const n = normal(pts[0], pts[1], pts[2]);
    const base = p.positions.length / 3;
    for (const v of pts) {
      p.positions.push(...v);
      p.normals.push(...n);
    }
    for (let i = 1; i < pts.length - 1; i++) p.indices.push(base, base + i, base + i + 1);
  }

  /**
   * Surface of revolution along Z. Each station: [z, radius, yCentre, xScale].
   * Smooth normals. Closed at both ends.
   */
  lathe(material: string, stations: [number, number, number?, number?][], segments = 16, offset: V3 = [0, 0, 0]) {
    const p = this.part(material);
    const base = p.positions.length / 3;
    for (const [z, r, yc = 0, xs = 1] of stations) {
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const x = Math.cos(a) * r * xs;
        const y = Math.sin(a) * r;
        p.positions.push(offset[0] + x, offset[1] + yc + y, offset[2] + z);
        const len = Math.hypot(Math.cos(a) / Math.max(xs, 1e-3), Math.sin(a)) || 1;
        p.normals.push(Math.cos(a) / Math.max(xs, 1e-3) / len, Math.sin(a) / len, 0);
      }
    }
    for (let i = 0; i < stations.length - 1; i++) {
      for (let s = 0; s < segments; s++) {
        const a = base + i * segments + s;
        const b = base + i * segments + ((s + 1) % segments);
        const c = base + (i + 1) * segments + s;
        const d = base + (i + 1) * segments + ((s + 1) % segments);
        // Stations go from tail (low z) to nose (high z); (a, b, c) winds counter-clockwise seen from outside.
        p.indices.push(a, b, c, b, d, c);
      }
    }
    // End caps (fans) so the mesh is closed.
    const capPts = (i: number): V3[] => {
      const out: V3[] = [];
      for (let s = 0; s < segments; s++) {
        const k = (base + i * segments + s) * 3;
        out.push([p.positions[k], p.positions[k + 1], p.positions[k + 2]]);
      }
      return out;
    };
    const first = capPts(0);
    const last = capPts(stations.length - 1);
    if (stations[0][1] > 0.001) this.poly(material, [...first].reverse());
    if (stations[stations.length - 1][1] > 0.001) this.poly(material, last);
  }

  /**
   * Tapered lifting surface with a diamond airfoil section, from `root` outwards along `dir`.
   * Used for wings (dir = ±X), horizontal tails, and vertical fins (dir = +Y).
   */
  surface(
    material: string,
    o: { root: V3; dir: 'x+' | 'x-' | 'y+'; span: number; rootChord: number; tipChord: number; sweepM: number; dihedralM: number; thickness: number },
  ) {
    const sect = (centre: V3, chord: number, t: number, alongX: boolean): V3[] => {
      // LE, top, TE, bottom (chord runs along -Z from the leading edge)
      const [cx, cy, cz] = centre;
      if (alongX) {
        return [
          [cx, cy, cz],
          [cx, cy + t / 2, cz - chord * 0.35],
          [cx, cy, cz - chord],
          [cx, cy - t / 2, cz - chord * 0.35],
        ];
      }
      // Vertical fin: thickness along X.
      return [
        [cx, cy, cz],
        [cx + t / 2, cy, cz - chord * 0.35],
        [cx, cy, cz - chord],
        [cx - t / 2, cy, cz - chord * 0.35],
      ];
    };
    const r = o.root;
    const alongX = o.dir !== 'y+';
    const sign = o.dir === 'x-' ? -1 : 1;
    const tip: V3 = alongX ? [r[0] + sign * o.span, r[1] + o.dihedralM, r[2] - o.sweepM] : [r[0], r[1] + o.span, r[2] - o.sweepM];
    const A = sect(r, o.rootChord, o.thickness, alongX);
    const B = sect(tip, o.tipChord, o.thickness * 0.55, alongX);
    // Section order (LE, top, TE, bottom) winds outward for x− and y+; the x+ side is mirrored so it is flipped.
    const flip = o.dir === 'x+';
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const quad: V3[] = [A[i], A[j], B[j], B[i]];
      this.poly(material, flip ? quad.reverse() : quad);
    }
    this.poly(material, flip ? [...B].reverse() : [...B]); // tip cap
    this.poly(material, flip ? [...A] : [...A].reverse()); // root cap
  }

  box(material: string, c: V3, size: V3) {
    const [x, y, z] = c;
    const [hx, hy, hz] = size.map((s) => s / 2) as V3;
    const v = (sx: number, sy: number, sz: number): V3 => [x + sx * hx, y + sy * hy, z + sz * hz];
    this.poly(material, [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)]);
    this.poly(material, [v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)]);
    this.poly(material, [v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)]);
    this.poly(material, [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)]);
    this.poly(material, [v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)]);
    this.poly(material, [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)]);
  }

  /** Thin disc in the plane perpendicular to `axis` (propellers, rotors). */
  disc(material: string, c: V3, radius: number, axis: 'y' | 'z', segments = 24) {
    const ring: V3[] = [];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      ring.push(axis === 'y' ? [c[0] + Math.cos(a) * radius, c[1], c[2] + Math.sin(a) * radius] : [c[0] + Math.cos(a) * radius, c[1] + Math.sin(a) * radius, c[2]]);
    }
    this.poly(material, ring);
    this.poly(material, [...ring].reverse());
  }
}

function normal(a: V3, b: V3, c: V3): V3 {
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

const MATERIALS: Record<string, { color: [number, number, number, number]; metallic: number; roughness: number; doubleSided?: boolean; blend?: boolean }> = {
  body: { color: [0.93, 0.94, 0.96, 1], metallic: 0.15, roughness: 0.45 },
  tail: { color: [0.86, 0.88, 0.93, 1], metallic: 0.15, roughness: 0.45 },
  engine: { color: [0.62, 0.64, 0.68, 1], metallic: 0.5, roughness: 0.35 },
  dark: { color: [0.07, 0.09, 0.13, 1], metallic: 0.2, roughness: 0.25 },
  gear: { color: [0.18, 0.18, 0.2, 1], metallic: 0.3, roughness: 0.6 },
  rotor: { color: [0.1, 0.1, 0.12, 0.35], metallic: 0, roughness: 0.8, doubleSided: true, blend: true },
};

// ── Aircraft definitions ──────────────────────────────────────────────────────

interface JetSpec {
  length: number;
  radius: number;
  gearH: number;
  span: number;
  rootChord: number;
  tipChord: number;
  sweepDeg: number;
  dihedralDeg: number;
  wingZ: number; // leading-edge root position from nose (fraction of length)
  wingY: number; // relative to fuselage centre (−radius = low wing, +radius = high wing)
  engines: { x: number; z: number; r: number; len: number; y: number }[];
  finH: number;
  finChord: number;
  stabSpan: number;
  stabChord: number;
  tTail?: boolean;
  props?: boolean;
}

function jet(s: JetSpec): Builder {
  const b = new Builder();
  const L = s.length;
  const R = s.radius;
  const yc = s.gearH + R; // fuselage centre height
  const z0 = -L / 2; // tail end
  // Fuselage: tail cone rises, nose is rounded.
  b.lathe(
    'body',
    [
      [z0, 0.05, R * 0.75],
      [z0 + L * 0.06, R * 0.32, R * 0.45],
      [z0 + L * 0.2, R * 0.82, R * 0.12],
      [z0 + L * 0.3, R, 0],
      [z0 + L * 0.84, R, 0],
      [z0 + L * 0.92, R * 0.86, -R * 0.05],
      [z0 + L * 0.97, R * 0.55, -R * 0.12],
      [z0 + L, 0.05, -R * 0.2],
    ],
    18,
    [0, yc, 0],
  );
  // Cockpit windshield band.
  b.box('dark', [0, yc + R * 0.42, z0 + L * 0.925], [R * 1.15, R * 0.28, L * 0.03]);
  // Wings.
  const half = s.span / 2 - R * 0.9;
  const sweep = Math.tan((s.sweepDeg * Math.PI) / 180) * half;
  const dih = Math.tan((s.dihedralDeg * Math.PI) / 180) * half;
  const wingRootZ = z0 + L * s.wingZ;
  const wy = yc + s.wingY;
  for (const dir of ['x+', 'x-'] as const) {
    b.surface('body', {
      root: [dir === 'x+' ? R * 0.85 : -R * 0.85, wy, wingRootZ],
      dir,
      span: half,
      rootChord: s.rootChord,
      tipChord: s.tipChord,
      sweepM: sweep,
      dihedralM: dih,
      thickness: s.rootChord * 0.12,
    });
  }
  // Wing box through the fuselage (hides the join).
  b.box('body', [0, wy, wingRootZ - s.rootChord * 0.45], [R * 1.8, s.rootChord * 0.1, s.rootChord * 0.9]);
  // Engines.
  for (const e of s.engines) {
    for (const side of [1, -1]) {
      const x = e.x * side;
      const ey = yc + e.y;
      const ez = e.z;
      b.lathe(
        'engine',
        [
          [ez - e.len, e.r * 0.55],
          [ez - e.len * 0.7, e.r * 0.85],
          [ez - e.len * 0.15, e.r],
          [ez, e.r * 0.92],
        ],
        14,
        [x, ey, 0],
      );
      b.disc('dark', [x, ey, ez + 0.01], e.r * 0.8, 'z', 14);
      if (s.props) b.disc('rotor', [x, ey, ez + 0.25], e.r * 2.6, 'z', 20);
      // Pylon to the wing / fuselage.
      const pylonTop = Math.abs(e.x) < R * 1.6 ? yc : wy;
      if (Math.abs(ey - pylonTop) > 0.2) b.box('engine', [x, (ey + pylonTop) / 2, ez - e.len * 0.45], [e.r * 0.25, Math.abs(ey - pylonTop), e.len * 0.6]);
    }
  }
  // Tail: vertical fin + horizontal stabiliser (conventional or T-tail).
  const finRootZ = z0 + L * 0.13 + s.finChord;
  b.surface('tail', {
    root: [0, yc + R * 0.55, finRootZ],
    dir: 'y+',
    span: s.finH,
    rootChord: s.finChord,
    tipChord: s.finChord * 0.45,
    sweepM: s.finChord * 0.65,
    dihedralM: 0,
    thickness: s.finChord * 0.12,
  });
  const stabY = s.tTail ? yc + R * 0.55 + s.finH * 0.97 : yc + R * 0.35;
  const stabZ = s.tTail ? finRootZ - s.finChord * 0.6 : z0 + L * 0.1 + s.stabChord;
  for (const dir of ['x+', 'x-'] as const) {
    b.surface('tail', {
      root: [dir === 'x+' ? (s.tTail ? 0.1 : R * 0.4) : s.tTail ? -0.1 : -R * 0.4, stabY, stabZ],
      dir,
      span: s.stabSpan / 2,
      rootChord: s.stabChord,
      tipChord: s.stabChord * 0.45,
      sweepM: s.stabChord * 0.55,
      dihedralM: s.tTail ? 0 : s.stabSpan * 0.03,
      thickness: s.stabChord * 0.1,
    });
  }
  // Landing gear (nose + mains), so models sit on their wheels.
  b.box('gear', [0, s.gearH / 2, z0 + L * 0.86], [0.35, s.gearH, 0.35]);
  for (const side of [1, -1]) b.box('gear', [side * R * 1.15, s.gearH / 2, wingRootZ - s.rootChord * 0.6], [0.6, s.gearH, 0.9]);
  return b;
}

function helicopter(): Builder {
  const b = new Builder();
  const yc = 1.6;
  b.lathe('body', [[-1.8, 0.2, 0.1], [-1.4, 0.75, 0.05, 0.8], [0.4, 1.05, 0, 0.82], [1.6, 0.85, -0.1, 0.8], [2.4, 0.15, -0.25]], 16, [0, yc, 0]);
  b.box('dark', [0, yc + 0.15, 2.0], [1.3, 0.6, 0.6]);
  // Tail boom + fin + tail rotor.
  b.lathe('body', [[-7.2, 0.12, 0.35], [-1.5, 0.32, 0.15]], 10, [0, yc, 0]);
  b.surface('tail', { root: [0, yc + 0.3, -6.3], dir: 'y+', span: 1.3, rootChord: 1.0, tipChord: 0.6, sweepM: 0.5, dihedralM: 0, thickness: 0.1 });
  b.disc('rotor', [0.25, yc + 0.9, -6.9], 0.85, 'z', 16);
  // Main rotor mast + disc.
  b.box('gear', [0, yc + 1.2, 0], [0.2, 0.6, 0.2]);
  b.disc('rotor', [0, yc + 1.5, 0], 5.5, 'y', 32);
  // Skids.
  for (const side of [1, -1]) {
    b.box('gear', [side * 1.0, 0.08, 0.2], [0.12, 0.12, 3.6]);
    b.box('gear', [side * 0.9, 0.5, 1.0], [0.08, 0.9, 0.08]);
    b.box('gear', [side * 0.9, 0.5, -0.7], [0.08, 0.9, 0.08]);
  }
  return b;
}

function light(): Builder {
  const b = new Builder();
  const yc = 1.25;
  b.lathe('body', [[-4.3, 0.08, 0.35], [-1.2, 0.55, 0.12, 0.8], [0.8, 0.62, 0.05, 0.85], [2.6, 0.55, -0.05, 0.85], [3.6, 0.3, -0.1]], 14, [0, yc, 0]);
  b.box('dark', [0, yc + 0.45, 1.6], [1.0, 0.4, 0.9]);
  for (const dir of ['x+', 'x-'] as const) {
    b.surface('body', { root: [dir === 'x+' ? 0.4 : -0.4, yc + 0.75, 1.4], dir, span: 5.2, rootChord: 1.55, tipChord: 1.3, sweepM: 0.05, dihedralM: 0.15, thickness: 0.18 });
    b.surface('tail', { root: [dir === 'x+' ? 0.1 : -0.1, yc + 0.25, -3.4], dir, span: 1.7, rootChord: 0.9, tipChord: 0.6, sweepM: 0.2, dihedralM: 0, thickness: 0.08 });
  }
  b.surface('tail', { root: [0, yc + 0.3, -3.0], dir: 'y+', span: 1.3, rootChord: 1.2, tipChord: 0.6, sweepM: 0.8, dihedralM: 0, thickness: 0.08 });
  b.disc('rotor', [0, yc, 3.7], 0.95, 'z', 18);
  b.box('gear', [0, 0.35, 2.4], [0.12, 0.7, 0.12]);
  for (const side of [1, -1]) b.box('gear', [side * 1.1, 0.35, 0.6], [0.15, 0.7, 0.3]);
  return b;
}

const SPECS: Record<string, () => Builder> = {
  narrowbody: () =>
    jet({
      length: 37.6, radius: 1.98, gearH: 1.6, span: 35.8, rootChord: 6.2, tipChord: 1.6, sweepDeg: 25, dihedralDeg: 5,
      wingZ: 0.36, wingY: -1.3, engines: [{ x: 5.75, z: 3.4, r: 1.1, len: 4.4, y: -2.35 }],
      finH: 6.3, finChord: 5.4, stabSpan: 12.4, stabChord: 3.5,
    }),
  widebody: () =>
    jet({
      length: 63.7, radius: 3.1, gearH: 2.2, span: 64.8, rootChord: 11, tipChord: 2.6, sweepDeg: 31, dihedralDeg: 6,
      wingZ: 0.37, wingY: -2.0, engines: [{ x: 9.7, z: 7.5, r: 1.75, len: 7.2, y: -3.6 }],
      finH: 10, finChord: 8.5, stabSpan: 21.5, stabChord: 5.5,
    }),
  regional: () =>
    jet({
      length: 36.2, radius: 1.5, gearH: 1.3, span: 28.7, rootChord: 5.2, tipChord: 1.3, sweepDeg: 23, dihedralDeg: 5,
      wingZ: 0.38, wingY: -1.0, engines: [{ x: 4.6, z: 2.8, r: 0.85, len: 3.4, y: -1.75 }],
      finH: 5.4, finChord: 4.4, stabSpan: 10, stabChord: 2.8,
    }),
  turboprop: () =>
    jet({
      length: 27.2, radius: 1.4, gearH: 1.0, span: 27, rootChord: 2.6, tipChord: 1.6, sweepDeg: 3, dihedralDeg: 1,
      wingZ: 0.45, wingY: 1.25, engines: [{ x: 4.1, z: 2.6, r: 0.55, len: 3.6, y: 0.95 }],
      finH: 4.6, finChord: 3.6, stabSpan: 7.3, stabChord: 1.8, tTail: true, props: true,
    }),
  bizjet: () =>
    jet({
      length: 20, radius: 1.05, gearH: 0.9, span: 19, rootChord: 3.4, tipChord: 1.1, sweepDeg: 28, dihedralDeg: 3,
      wingZ: 0.42, wingY: -0.7, engines: [{ x: 1.75, z: -4.6, r: 0.55, len: 2.8, y: 0.45 }],
      finH: 3.4, finChord: 3.0, stabSpan: 7.2, stabChord: 1.7, tTail: true,
    }),
  helicopter: helicopter,
  light: light,
};
SPECS.generic = SPECS.narrowbody;

// ── GLB writer ────────────────────────────────────────────────────────────────

function toGlb(b: Builder): Buffer {
  const bins: Buffer[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const primitives: object[] = [];
  const materials: object[] = [];
  const matIndex = new Map<string, number>();
  const push = (data: Buffer, target: number) => {
    const pad = (4 - (data.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target });
    bins.push(data, Buffer.alloc(pad));
    offset += data.length + pad;
    return bufferViews.length - 1;
  };
  for (const [mat, part] of b.parts) {
    if (!matIndex.has(mat)) {
      const m = MATERIALS[mat];
      matIndex.set(mat, materials.length);
      materials.push({
        name: mat,
        pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: m.metallic, roughnessFactor: m.roughness },
        doubleSided: !!m.doubleSided,
        ...(m.blend ? { alphaMode: 'BLEND' } : {}),
      });
    }
    const pos = Float32Array.from(part.positions);
    const nor = Float32Array.from(part.normals);
    const count = pos.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i * 3 + k]);
      max[k] = Math.max(max[k], pos[i * 3 + k]);
    }
    const idx = count > 65535 ? Uint32Array.from(part.indices) : Uint16Array.from(part.indices);
    const pv = push(Buffer.from(pos.buffer), 34962);
    accessors.push({ bufferView: pv, componentType: 5126, count, type: 'VEC3', min, max });
    const nv = push(Buffer.from(nor.buffer), 34962);
    accessors.push({ bufferView: nv, componentType: 5126, count, type: 'VEC3' });
    const iv = push(Buffer.from(idx.buffer), 34963);
    accessors.push({ bufferView: iv, componentType: count > 65535 ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: matIndex.get(mat) });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'SkyView3D build-models', copyright: 'CC0-1.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'aircraft' }],
    meshes: [{ primitives }],
    materials,
    buffers: [{ byteLength: offset }],
    bufferViews,
    accessors,
  };
  let jsonBuf = Buffer.from(JSON.stringify(gltf));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(bins);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'models');
mkdirSync(out, { recursive: true });
for (const [name, make] of Object.entries(SPECS)) {
  const b = make();
  const glb = toGlb(b);
  writeFileSync(join(out, `${name}.glb`), glb);
  const tris = [...b.parts.values()].reduce((n, p) => n + p.indices.length / 3, 0);
  console.log(`${name}.glb  ${(glb.length / 1024).toFixed(1)} KiB  ${tris} triangles`);
}
