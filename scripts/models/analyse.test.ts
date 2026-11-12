import { describe, expect, it } from 'vitest';
import { analyse, detectAxes, ZONE, type MeshIn, type V3 } from './analyse';

/** Box as a 12-triangle mesh. */
function box(min: V3, max: V3): MeshIn {
  const p: number[] = [];
  for (let i = 0; i < 8; i++) p.push(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
  const idx = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
  return { pos: new Float32Array(p), idx: new Uint32Array(idx) };
}

/** Tube along Z (the fuselage), with rings so there are vertices along the whole length. */
function tube(r: number, cy: number, z0: number, z1: number, cx = 0, rings = 24, seg = 16): MeshIn {
  const p: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= rings; k++) for (let s = 0; s < seg; s++) p.push(cx + r * Math.cos((s / seg) * 2 * Math.PI), cy + r * Math.sin((s / seg) * 2 * Math.PI), z0 + ((z1 - z0) * k) / rings);
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < seg; s++) {
      const a = k * seg + s;
      const b = k * seg + ((s + 1) % seg);
      idx.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  return { pos: new Float32Array(p), idx: new Uint32Array(idx) };
}

/** A simple airliner in the app frame: X left, Y up, Z forward, wheels on y = 0. Length 40, span 36. */
function airliner(): MeshIn[] {
  return [
    tube(2, 4, -20, 20), // fuselage
    box([-18, 3, -3], [18, 3.3, 3]), // wing
    box([-0.15, 6.2, -19], [0.15, 12, -14]), // fin
    box([-6, 4.2, -16.5], [6, 4.4, -14]), // tailplane
    tube(1.1, 1.8, 1, 5, 6, 4), // left engine
    tube(1.1, 1.8, 1, 5, -6, 4), // right engine
    box([-0.3, 0, 14], [0.3, 1.9, 14.6]), // nose gear
    box([2.6, 0, -2], [3.4, 2.4, -1]), // main gear
    box([-3.4, 0, -2], [-2.6, 2.4, -1]),
  ];
}

function cloud(meshes: MeshIn[], map: (x: number, y: number, z: number) => V3): Float32Array {
  const out: number[] = [];
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) out.push(...map(m.pos[i], m.pos[i + 1], m.pos[i + 2]));
  return new Float32Array(out);
}

describe('detectAxes', () => {
  it('finds nose and top when the model is already in the app frame', () => {
    expect(detectAxes(cloud(airliner(), (x, y, z) => [x, y, z]))).toEqual({ fwd: [0, 0, 1], up: [0, 1, 0] });
  });
  it('finds them in other export conventions', () => {
    // Nose along −X, Z up.
    expect(detectAxes(cloud(airliner(), (x, y, z) => [-z, x, y]))).toEqual({ fwd: [-1, 0, 0], up: [0, 0, 1] });
    // Nose along +Y, upside down in X.
    expect(detectAxes(cloud(airliner(), (x, y, z) => [-y, z, x]))).toEqual({ fwd: [0, 1, 0], up: [-1, 0, 0] });
  });
});

describe('analyse', () => {
  const meshes = airliner();
  const an = analyse(meshes);
  const zonesOf = (i: number) => new Set(an.meshes[i].zone);

  it('measures the fuselage', () => {
    expect(an.radius).toBeCloseTo(2, 1);
    expect(an.axisY).toBeCloseTo(4, 1);
    expect(an.length).toBeCloseTo(40, 3);
  });
  it('marks fuselage, fin and engine cowls, and leaves wings alone', () => {
    expect(zonesOf(0)).toEqual(new Set([ZONE.FUSELAGE]));
    expect(zonesOf(1)).toEqual(new Set([ZONE.NONE]));
    expect(zonesOf(2)).toEqual(new Set([ZONE.TAIL]));
    expect(zonesOf(3)).toEqual(new Set([ZONE.NONE]));
    expect(zonesOf(4)).toEqual(new Set([ZONE.ENGINE]));
    expect(zonesOf(5)).toEqual(new Set([ZONE.ENGINE]));
    expect(an.counts.nacelles).toBe(2);
  });
  it('finds the landing gear and nothing else', () => {
    for (const i of [6, 7, 8]) expect([...an.meshes[i].gearTri].every((g) => g === 1)).toBe(true);
    for (const i of [0, 1, 2, 3, 4, 5]) expect(an.meshes[i].gearTri.includes(1)).toBe(false);
  });
  it('gives paint coordinates along and around the fuselage, and up the fin', () => {
    const f = an.meshes[0];
    for (let v = 0; v < f.src.length; v++) {
      const s = f.src[v];
      expect(f.paint[v * 2]).toBeCloseTo((meshes[0].pos[s * 3 + 2] + 20) / 40, 5);
      expect(f.paint[v * 2 + 1]).toBeCloseTo((meshes[0].pos[s * 3 + 1] - 4) / 2, 1);
    }
    const fin = an.meshes[2];
    const bands = [...fin.paint].filter((_, i) => i % 2 === 1);
    expect(Math.min(...bands)).toBeCloseTo(0, 1);
    expect(Math.max(...bands)).toBeCloseTo(1, 5);
  });
  it('splits vertices where zones meet so paint does not bleed across triangles', () => {
    // One mesh: a fuselage tube with a fin triangle that reuses a crown vertex.
    const t = tube(2, 4, -20, 20);
    const crown = 4; // ring 0, top of the tube (angle 90°)
    const n = t.pos.length / 3;
    const pos = new Float32Array([...t.pos, 0, 12, -19, 0, 12, -15]);
    const idx = new Uint32Array([...t.idx, crown, n, n + 1]);
    const out = analyse([{ pos, idx }, box([-18, 3, -3], [18, 3.3, 3]), box([-0.3, 0, 14], [0.3, 1.9, 14.6])]).meshes[0];
    expect(out.src.length).toBe(n + 3);
    const last = out.idx.slice(-3);
    expect([...last].map((i) => out.zone[i])).toEqual([ZONE.TAIL, ZONE.TAIL, ZONE.TAIL]);
  });
});
