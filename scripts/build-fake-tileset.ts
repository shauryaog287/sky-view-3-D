/**
 * Test fixture: a stand-in for Google Photorealistic 3D Tiles over Delhi (40 × 40 km of orange checkered "ground"
 * with box "buildings", at a realistic ellipsoid height). Used in mock mode with `?fake3d=1` to check the photoreal
 * code paths without a key — e.g. that "3D at airports only" keeps it inside the airport and shows the flat 2D map
 * around it.   npx tsx scripts/build-fake-tileset.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, toGlb, type V3 } from './models/core';

const LAT = 28.5665;
const LON = 77.1031;
const H = 185; // ≈ Delhi airport ground, ellipsoid metres
const HALF = 20_000;
const CELL = 2_000;

const b = new Builder();
for (let x = -HALF; x < HALF; x += CELL) {
  for (let n = -HALF; n < HALF; n += CELL) {
    // glTF is y-up; 3D Tiles content maps glTF +X → east, −Z → north, +Y → up.
    const q: V3[] = [
      [x, 0, -n],
      [x, 0, -(n + CELL)],
      [x + CELL, 0, -(n + CELL)],
      [x + CELL, 0, -n],
    ];
    b.poly(((x + n) / CELL) % 2 === 0 ? 'a' : 'b', q);
  }
}
for (let x = -HALF + 1250; x < HALF; x += 2500) {
  for (let n = -HALF + 1250; n < HALF; n += 2500) {
    const h = 20 + ((Math.abs(x * 7 + n * 13) / 1500) % 5) * 12;
    b.box('box', [x, h / 2, -n], [180, h, 180]);
  }
}
const mat = (c: [number, number, number]) => ({ color: [...c, 1] as [number, number, number, number], metallic: 0, roughness: 0.9, doubleSided: true });
const glb = toGlb(b, { a: mat([0.9, 0.35, 0.05]), b: mat([0.55, 0.18, 0.02]), box: mat([0.75, 0.75, 0.78]) });

// East-north-up frame at the centre (column-major 4×4).
const a = 6378137;
const e2 = 6.69437999014e-3;
const φ = (LAT * Math.PI) / 180;
const λ = (LON * Math.PI) / 180;
const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
const X = (N + H) * Math.cos(φ) * Math.cos(λ);
const Y = (N + H) * Math.cos(φ) * Math.sin(λ);
const Z = (N * (1 - e2) + H) * Math.sin(φ);
const east = [-Math.sin(λ), Math.cos(λ), 0];
const north = [-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ)];
const up = [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
const tileset = {
  asset: { version: '1.1', generator: 'SkyView3D build-fake-tileset (test fixture)' },
  geometricError: 200,
  root: {
    transform: [...east, 0, ...north, 0, ...up, 0, X, Y, Z, 1],
    boundingVolume: { box: [0, 0, 40, HALF, 0, 0, 0, HALF, 0, 0, 0, 60] },
    geometricError: 0,
    refine: 'ADD',
    content: { uri: 'ground.glb' },
  },
};
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'fake3d');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'ground.glb'), glb);
writeFileSync(join(out, 'tileset.json'), JSON.stringify(tileset, null, 1));
console.log(`fake tileset: ${(glb.length / 1024).toFixed(0)} KiB → ${out}`);
