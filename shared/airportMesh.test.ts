import { describe, expect, it } from 'vitest';
import type { Airport3D } from './airport3d';
import { MAT, buildAirportMesh, orientedBox } from './airportMesh';
import vidpJson from '../public/airports3d/VIDP.json';

const base: Airport3D = { v: 2, icao: 'TEST', origin: [0, 0], generated: 'x', attribution: 'x', buildings: [], bridges: [], towers: [], aprons: [], taxiways: [] };
const rect = (x: number, y: number, w: number, d: number) => [x, y, x + w, y, x + w, y + d, x, y + d];

function check(mesh: ReturnType<typeof buildAirportMesh>) {
  const n = mesh.position.length / 3;
  expect(mesh.normal.length).toBe(n * 3);
  expect(mesh.uv.length).toBe(n * 2);
  expect(mesh.color.length).toBe(n * 3);
  expect(mesh.mat.length).toBe(n * 3);
  expect(mesh.index.length % 3).toBe(0);
  for (const i of mesh.index) expect(i).toBeLessThan(n);
  for (const v of mesh.position) expect(Number.isFinite(v)).toBe(true);
  for (let k = 0; k < n; k++) expect(Math.hypot(mesh.normal[k * 3], mesh.normal[k * 3 + 1], mesh.normal[k * 3 + 2])).toBeCloseTo(1, 3);
}

describe('airport mesh', () => {
  it('extrudes a block with outward walls and an upward roof, whatever the winding', () => {
    for (const ring of [rect(0, 0, 40, 20), rect(0, 0, 40, 20).reduce<number[]>((r, _v, i, a) => (i % 2 ? r : [a[i], a[i + 1], ...r]), [])]) {
      const mesh = buildAirportMesh({ ...base, buildings: [{ k: 'building', h: 12, ring }] });
      check(mesh);
      // Every wall normal points away from the building centre (20, 10).
      for (let k = 0; k < mesh.position.length / 3; k++) {
        const nz = mesh.normal[k * 3 + 2];
        if (Math.abs(nz) > 0.5) continue;
        const dx = mesh.position[k * 3] - 20;
        const dy = mesh.position[k * 3 + 1] - 10;
        expect(dx * mesh.normal[k * 3] + dy * mesh.normal[k * 3 + 1]).toBeGreaterThan(0);
      }
      // Triangles are counter-clockwise seen from outside (cross product agrees with the stored normal).
      for (let t = 0; t < mesh.index.length; t += 3) {
        const [a, b, c] = [mesh.index[t], mesh.index[t + 1], mesh.index[t + 2]];
        const p = (i: number) => [mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]];
        const [pa, pb, pc] = [p(a), p(b), p(c)];
        const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        expect(cr[0] * mesh.normal[a * 3] + cr[1] * mesh.normal[a * 3 + 1] + cr[2] * mesh.normal[a * 3 + 2]).toBeGreaterThan(0);
      }
      expect(Math.max(...mesh.position.filter((_v, i) => i % 3 === 2))).toBe(12);
    }
  });

  it('gives terminals glass walls and hangars a shaped metal roof', () => {
    const t = buildAirportMesh({ ...base, buildings: [{ k: 'terminal', h: 28, ring: rect(0, 0, 300, 60) }] });
    expect([...t.mat].filter((_v, i) => i % 3 === 0)).toContain(MAT.GLASS);
    const h = buildAirportMesh({ ...base, buildings: [{ k: 'hangar', h: 20, ring: rect(0, 0, 80, 60) }] });
    check(h);
    expect([...h.mat].filter((_v, i) => i % 3 === 0)).toContain(MAT.ROOF_METAL);
    // The ridge reaches the building height; eaves are lower.
    const zs = [...h.position].filter((_v, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(20, 3);
  });

  it('builds towers, jet bridges, tanks and masts', () => {
    const mesh = buildAirportMesh({
      ...base,
      towers: [{ x: 0, y: 0, h: 60, r: 6 }],
      bridges: [{ line: [10, 0, 40, 0, 60, 10], w: 3.6 }],
      tanks: [{ x: 100, y: 0, r: 10, h: 12 }],
      masts: [{ x: 150, y: 0, h: 30 }],
    });
    check(mesh);
    expect([...mesh.mat].filter((_v, i) => i % 3 === 0)).toContain(MAT.CAB);
    expect([...mesh.mat].filter((_v, i) => i % 3 === 0)).toContain(MAT.BRIDGE);
    expect(mesh.tops.length).toBe(2); // tower antenna and mast head
  });

  it('finds the oriented box of a rotated rectangle', () => {
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    const ring = [[-40, -10], [40, -10], [40, 10], [-40, 10]].flatMap(([x, y]) => [x * c - y * s, x * s + y * c]);
    const b = orientedBox(ring);
    expect(b.hl).toBeCloseTo(40, 3);
    expect(b.hw).toBeCloseTo(10, 3);
    expect(Math.abs(b.ax * c + b.ay * s)).toBeCloseTo(1, 3);
  });

  it('handles a real airport (Delhi)', () => {
    const mesh = buildAirportMesh(vidpJson as unknown as Airport3D);
    check(mesh);
    expect(mesh.index.length / 3).toBeGreaterThan(5000);
    expect(mesh.index.length / 3).toBeLessThan(400_000);
  });
});
