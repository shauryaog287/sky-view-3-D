/**
 * Low-level geometry, texture and GLB writing for the generated aircraft models.
 * Coordinate system (glTF): +Y up, +Z forward (nose), +X = left wing. Metres. Origin on the ground under the
 * middle of the fuselage.
 */
import { deflateSync } from 'node:zlib';

export type V3 = [number, number, number];
export type RGB = [number, number, number];

export interface MaterialDef {
  color: [number, number, number, number];
  metallic: number;
  roughness: number;
  doubleSided?: boolean;
  blend?: boolean;
  /** Key of a texture passed to toGlb, used as base colour. */
  texture?: string;
  emissive?: RGB;
}

export interface Part {
  positions: number[];
  normals: number[];
  uvs: number[];
  livery: number[];
  indices: number[];
}

/** Lathe station: [z, radius (vertical half-height), y of the centre, x scale (half-width / radius)]. */
export type Station = [number, number, number?, number?];

export class Builder {
  /** Parts keyed by `${group}|${material}`; each group becomes a named glTF node (e.g. "gear" can be hidden). */
  readonly parts = new Map<string, Part>();
  group = 'body';

  part(material: string): Part {
    const key = `${this.group}|${material}`;
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { positions: [], normals: [], uvs: [], livery: [], indices: [] }));
    return p;
  }

  inGroup(name: string, fn: () => void) {
    const prev = this.group;
    this.group = name;
    try {
      fn();
    } finally {
      this.group = prev;
    }
  }

  private vert(p: Part, pos: V3, n: V3, uv: [number, number], livery: number) {
    p.positions.push(pos[0], pos[1], pos[2]);
    p.normals.push(n[0], n[1], n[2]);
    p.uvs.push(uv[0], uv[1]);
    p.livery.push(livery);
    return p.positions.length / 3 - 1;
  }

  /** Flat-shaded convex polygon (CCW seen from outside). */
  poly(material: string, pts: V3[], livery = 0) {
    const p = this.part(material);
    const n = newellNormal(pts);
    const ids = pts.map((v) => this.vert(p, v, n, [0.5, 0.5], livery));
    for (let i = 1; i < ids.length - 1; i++) p.indices.push(ids[0], ids[i], ids[i + 1]);
  }

  /**
   * Surface of revolution along Z with smooth normals and UVs (u along z within [uZ0, uZ1], v around, starting at
   * +X and going up over the top). Stations must be in increasing z. Seam vertices are duplicated so the texture
   * wraps cleanly. `inside` flips it to face inwards (engine inlets).
   */
  lathe(
    material: string,
    stations: Station[],
    segments: number,
    offset: V3 = [0, 0, 0],
    o: { uZ0?: number; uZ1?: number; livery?: number; caps?: boolean; inside?: boolean } = {},
  ) {
    const p = this.part(material);
    const zs = stations.map((s) => s[0]);
    const uZ0 = o.uZ0 ?? Math.min(...zs);
    const uZ1 = o.uZ1 ?? Math.max(...zs);
    const base = p.positions.length / 3;
    const ring = segments + 1;
    const flip = o.inside ? -1 : 1;
    for (let i = 0; i < stations.length; i++) {
      const [z, r, yc = 0, xs = 1] = stations[i];
      // Slope of the radius gives the normal's z component (smooth nose/tail shading).
      const prev = stations[Math.max(0, i - 1)];
      const next = stations[Math.min(stations.length - 1, i + 1)];
      const dz = next[0] - prev[0];
      const slope = Math.abs(dz) < 1e-6 ? 0 : -(next[1] - prev[1]) / dz;
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const nx = Math.cos(a) / Math.max(xs, 1e-3);
        const ny = Math.sin(a);
        const len = Math.hypot(nx, ny, slope) || 1;
        this.vert(
          p,
          [offset[0] + Math.cos(a) * r * xs, offset[1] + yc + Math.sin(a) * r, offset[2] + z],
          [(flip * nx) / len, (flip * ny) / len, (flip * slope) / len],
          [(z - uZ0) / (uZ1 - uZ0 || 1), s / segments],
          o.livery ?? 0,
        );
      }
    }
    for (let i = 0; i < stations.length - 1; i++) {
      for (let s = 0; s < segments; s++) {
        const a = base + i * ring + s;
        const b = a + 1;
        const c = a + ring;
        const d = c + 1;
        if (o.inside) p.indices.push(a, c, b, b, c, d);
        else p.indices.push(a, b, c, b, d, c);
      }
    }
    if (o.caps !== false && !o.inside) {
      const cap = (i: number, flipCap: boolean) => {
        const pts: V3[] = [];
        for (let s = 0; s < segments; s++) {
          const k = (base + i * ring + s) * 3;
          pts.push([p.positions[k], p.positions[k + 1], p.positions[k + 2]]);
        }
        this.poly(material, flipCap ? pts.reverse() : pts, o.livery ?? 0);
      };
      if (stations[0][1] > 0.01) cap(0, true);
      if (stations[stations.length - 1][1] > 0.01) cap(stations.length - 1, false);
    }
  }

  /**
   * Lofted surface through cross-sections that all have the same number of points (wings, fins, pylons, blades).
   * Normals are smoothed along each section; open sections (airfoils, TE duplicated) keep a sharp trailing edge.
   * Winding is chosen so faces point away from the loft's centre line. Ends are capped.
   */
  loft(material: string, sections: V3[][], o: { livery?: number; caps?: boolean; smooth?: boolean; closedRing?: boolean } = {}) {
    const p = this.part(material);
    const n = sections[0].length;
    const lv = o.livery ?? 0;
    const centre = (sec: V3[]): V3 => {
      const c: V3 = [0, 0, 0];
      for (const v of sec) for (let k = 0; k < 3; k++) c[k] += v[k] / sec.length;
      return c;
    };
    // Orientation check on the first quad.
    const c0 = centre(sections[0]);
    const c1 = centre(sections[1]);
    const mid: V3 = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];
    let score = 0;
    for (let i = 0; i < n - 1; i++) {
      const q = [sections[0][i], sections[0][i + 1], sections[1][i + 1], sections[1][i]];
      const fn = newellNormal(q);
      const qc = centre(q);
      score += fn[0] * (qc[0] - mid[0]) + fn[1] * (qc[1] - mid[1]) + fn[2] * (qc[2] - mid[2]);
    }
    const reverse = score < 0;
    // Smooth normals: average the face normals around each vertex.
    const S = sections.length;
    const acc: V3[] = Array.from({ length: S * n }, () => [0, 0, 0]);
    const faceN = (j: number, i: number) => {
      const q = [sections[j][i], sections[j][i + 1], sections[j + 1][i + 1], sections[j + 1][i]];
      const f = newellNormal(q);
      return reverse ? ([-f[0], -f[1], -f[2]] as V3) : f;
    };
    if (o.smooth !== false) {
      for (let j = 0; j < S - 1; j++)
        for (let i = 0; i < n - 1; i++) {
          const f = faceN(j, i);
          for (const [jj, ii] of [
            [j, i],
            [j, i + 1],
            [j + 1, i],
            [j + 1, i + 1],
          ])
            for (let k = 0; k < 3; k++) acc[jj * n + ii][k] += f[k];
        }
      if (o.closedRing) {
        // First and last point of each ring coincide: share their normal so there is no shading seam.
        for (let j = 0; j < S; j++) {
          const a = acc[j * n];
          const b = acc[j * n + n - 1];
          for (let k = 0; k < 3; k++) a[k] = b[k] = a[k] + b[k];
        }
      }
      const base = p.positions.length / 3;
      for (let j = 0; j < S; j++)
        for (let i = 0; i < n; i++) {
          const a = acc[j * n + i];
          const l = Math.hypot(...a) || 1;
          this.vert(p, sections[j][i], [a[0] / l, a[1] / l, a[2] / l], [i / (n - 1), j / (S - 1)], lv);
        }
      for (let j = 0; j < S - 1; j++)
        for (let i = 0; i < n - 1; i++) {
          const a = base + j * n + i;
          const b = a + 1;
          const c = a + n;
          const d = c + 1;
          if (reverse) p.indices.push(a, c, b, b, c, d);
          else p.indices.push(a, b, c, b, d, c);
        }
    } else {
      for (let j = 0; j < S - 1; j++)
        for (let i = 0; i < n - 1; i++) {
          const q: V3[] = [sections[j][i], sections[j][i + 1], sections[j + 1][i + 1], sections[j + 1][i]];
          this.poly(material, reverse ? q.reverse() : q, lv);
        }
    }
    if (o.caps !== false) {
      const capOut = (sec: V3[], other: V3[]) => {
        const nn = newellNormal(sec);
        const c = centre(sec);
        const oc = centre(other);
        const out = nn[0] * (c[0] - oc[0]) + nn[1] * (c[1] - oc[1]) + nn[2] * (c[2] - oc[2]) >= 0;
        // Airfoil sections have a duplicated trailing edge point; drop it for the cap.
        const ring = dist(sec[0], sec[sec.length - 1]) < 1e-6 ? sec.slice(0, -1) : sec;
        this.poly(material, out ? ring : [...ring].reverse(), lv);
      };
      capOut(sections[S - 1], sections[S - 2]);
      capOut(sections[0], sections[1]);
    }
  }

  /** Cylinder along the X axis (wheels, axles). */
  cylinderX(material: string, c: V3, radius: number, width: number, segments = 14) {
    this.tube(material, [c[0] - width / 2, c[1], c[2]], [c[0] + width / 2, c[1], c[2]], radius, segments);
  }

  /** Closed cylinder between two points. */
  tube(material: string, a: V3, b: V3, radius: number, segments = 10) {
    const ax = sub(b, a);
    const len = Math.hypot(...ax);
    const d: V3 = [ax[0] / len, ax[1] / len, ax[2] / len];
    const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(d, ref));
    const v = cross(d, u);
    const ringAt = (o: V3) => {
      const pts: V3[] = [];
      for (let s = 0; s <= segments; s++) {
        const t = (s / segments) * Math.PI * 2;
        const ct = Math.cos(t) * radius;
        const st = Math.sin(t) * radius;
        pts.push([o[0] + u[0] * ct + v[0] * st, o[1] + u[1] * ct + v[1] * st, o[2] + u[2] * ct + v[2] * st]);
      }
      return pts;
    };
    this.loft(material, [ringAt(a), ringAt(b)], { closedRing: true });
  }

  box(material: string, c: V3, size: V3, livery = 0) {
    const [x, y, z] = c;
    const [hx, hy, hz] = size.map((s) => s / 2) as V3;
    const v = (sx: number, sy: number, sz: number): V3 => [x + sx * hx, y + sy * hy, z + sz * hz];
    this.poly(material, [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], livery);
    this.poly(material, [v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)], livery);
    this.poly(material, [v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)], livery);
    this.poly(material, [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)], livery);
    this.poly(material, [v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)], livery);
    this.poly(material, [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], livery);
  }

  /** Small sphere (navigation lights). */
  sphere(material: string, c: V3, r: number, segments = 6) {
    const st: Station[] = [];
    for (let i = 0; i <= 4; i++) {
      const t = (i / 4) * Math.PI;
      st.push([-Math.cos(t) * r, Math.max(0.001, Math.sin(t) * r)]);
    }
    this.lathe(material, st, segments, c, { caps: false });
  }

  /** Thin double-sided disc perpendicular to an axis (propeller blur, rotors, fan faces). */
  disc(material: string, c: V3, radius: number, axis: 'y' | 'z', segments = 24, inner = 0) {
    const ring = (r: number): V3[] => {
      const out: V3[] = [];
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        out.push(axis === 'y' ? [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r] : [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]]);
      }
      return out;
    };
    if (inner <= 0) {
      const r = ring(radius);
      this.poly(material, r);
      this.poly(material, [...r].reverse());
      return;
    }
    const o = ring(radius);
    const i = ring(inner);
    for (let s = 0; s < segments; s++) {
      const t = (s + 1) % segments;
      const q: V3[] = [o[s], o[t], i[t], i[s]];
      this.poly(material, q);
      this.poly(material, [...q].reverse());
    }
  }

  triangles(): number {
    let n = 0;
    for (const p of this.parts.values()) n += p.indices.length / 3;
    return n;
  }
}

// ── Vector helpers ───────────────────────────────────────────────────────────

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function norm(a: V3): V3 {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** Robust polygon normal (Newell's method). */
export function newellNormal(pts: V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm(n);
}

export function hex(c: string): RGB {
  const v = parseInt(c.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ── Texture (RGB) and PNG encoding ───────────────────────────────────────────

export class Texture {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
    fill: RGB = [255, 255, 255],
  ) {
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.data.set(fill, i * 3);
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      Buffer.from(this.data.buffer, this.data.byteOffset + y * this.w * 3, this.w * 3).copy(raw, y * (this.w * 3 + 1) + 1);
    }
    const chunk = (type: string, body: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length);
      const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(tb) >>> 0);
      return Buffer.concat([len, tb, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2; // RGB
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── GLB writer ───────────────────────────────────────────────────────────────

/**
 * Writes one mesh + node per builder group (child nodes of a root "aircraft" node). Every primitive carries POSITION,
 * NORMAL, TEXCOORD_0 and the custom `_LIVERY` attribute (1 = paint with the airline colour), so the runtime shader can
 * rely on it.
 */
export function toGlb(b: Builder, materials: Record<string, MaterialDef>, textures: Record<string, Buffer> = {}, meta: Record<string, unknown> = {}): Buffer {
  const bins: Buffer[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const mats: object[] = [];
  const matIndex = new Map<string, number>();
  const push = (data: Buffer, target?: number) => {
    const pad = (4 - (data.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, ...(target ? { target } : {}) });
    bins.push(data, Buffer.alloc(pad));
    offset += data.length + pad;
    return bufferViews.length - 1;
  };
  const texKeys = Object.keys(textures);
  const images = texKeys.map((k) => ({ bufferView: push(textures[k]), mimeType: 'image/png', name: k }));
  const groups = new Map<string, object[]>();
  for (const [key, part] of b.parts) {
    if (!part.indices.length) continue;
    const [group, mat] = key.split('|');
    const m = materials[mat];
    if (!m) throw new Error(`unknown material ${mat}`);
    if (!matIndex.has(mat)) {
      matIndex.set(mat, mats.length);
      const ti = m.texture ? texKeys.indexOf(m.texture) : -1;
      if (m.texture && ti < 0) throw new Error(`material ${mat}: missing texture ${m.texture}`);
      mats.push({
        name: mat,
        pbrMetallicRoughness: {
          baseColorFactor: m.color,
          metallicFactor: m.metallic,
          roughnessFactor: m.roughness,
          ...(ti >= 0 ? { baseColorTexture: { index: ti } } : {}),
        },
        doubleSided: !!m.doubleSided,
        ...(m.blend ? { alphaMode: 'BLEND' } : {}),
        ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
      });
    }
    const pos = Float32Array.from(part.positions);
    const count = pos.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i * 3 + k]);
        max[k] = Math.max(max[k], pos[i * 3 + k]);
      }
    const idx = count > 65535 ? Uint32Array.from(part.indices) : Uint16Array.from(part.indices);
    const addAcc = (arr: Float32Array, type: string, extra: object = {}) => {
      const v = push(Buffer.from(arr.buffer), 34962);
      accessors.push({ bufferView: v, componentType: 5126, count, type, ...extra });
      return accessors.length - 1;
    };
    const POSITION = addAcc(pos, 'VEC3', { min, max });
    const NORMAL = addAcc(Float32Array.from(part.normals), 'VEC3');
    const TEXCOORD_0 = addAcc(Float32Array.from(part.uvs), 'VEC2');
    const _LIVERY = addAcc(Float32Array.from(part.livery), 'SCALAR');
    const iv = push(Buffer.from(idx.buffer), 34963);
    accessors.push({ bufferView: iv, componentType: count > 65535 ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
    const prims = groups.get(group) ?? [];
    prims.push({ attributes: { POSITION, NORMAL, TEXCOORD_0, _LIVERY }, indices: accessors.length - 1, material: matIndex.get(mat) });
    groups.set(group, prims);
  }
  const names = [...groups.keys()];
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'SkyView3D build-models', copyright: 'CC0-1.0', extras: meta },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'aircraft', children: names.map((_, i) => i + 1) }, ...names.map((n, i) => ({ name: n, mesh: i }))],
    meshes: names.map((n) => ({ name: n, primitives: groups.get(n) })),
    materials: mats,
    buffers: [{ byteLength: offset }],
    bufferViews,
    accessors,
  };
  if (images.length) {
    gltf.images = images;
    gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 10497 }];
    gltf.textures = images.map((_, i) => ({ source: i, sampler: 0 }));
  }
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
