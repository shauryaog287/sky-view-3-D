/**
 * General-aviation shapes: a light twin-engine helicopter (H145/AW139 class) and single-engine piston aircraft
 * (high-wing C172 and low-wing PA-28/SR22 class). Same conventions as airliner.ts.
 */
import { Builder, hex, type Station, type V3 } from './core';
import type { Built } from './airliner';
import { inPoly, inRounded, paintLathe, type Layer } from './paint';

const C = { white: hex('#f3f4f6'), glass: hex('#16202b'), seam: hex('#a9b0b8'), stripe: hex('#1d3b8f'), dark: hex('#30343a') };
const mirror = (v: V3): V3 => [-v[0], v[1], v[2]];

function flat(le: V3, chord: number, t: number, thick: V3): V3[] {
  const xs = [1, 0.7, 0.4, 0.15, 0.04, 0, 0.04, 0.15, 0.4, 0.7, 1];
  return xs.map((x, i) => {
    const s = i < 5 ? 1 : i > 5 ? -0.8 : 0;
    const y = 5 * t * chord * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) * s;
    return [le[0] + thick[0] * y, le[1] + thick[1] * y, le[2] - x * chord + thick[2] * y];
  });
}

export function buildHelicopter(): Built {
  const b = new Builder();
  const yc = 1.45;
  // Cabin pod: rounded glass nose, flat-ish floor, tapering into the boom.
  const st: Station[] = [
    [-2.2, 0.5, yc + 0.3, 0.9],
    [-1.6, 0.72, yc + 0.18, 0.92],
    [-0.6, 0.88, yc + 0.06, 0.95],
    [0.6, 0.9, yc + 0.02, 0.95],
    [1.6, 0.82, yc - 0.04, 0.95],
    [2.3, 0.62, yc - 0.12, 0.98],
    [2.75, 0.36, yc - 0.2, 1.0],
    [2.95, 0.12, yc - 0.26, 1.0],
    [3.0, 0.001, yc - 0.28, 1.0],
  ];
  b.lathe('fuselage', st, 28, [0, 0, 0], { uZ0: -2.2, uZ1: 3.0, livery: 0.25 });
  const layers: Layer[] = [
    // Large wrap-around windscreen and chin windows.
    (p) => (p.z > 1.35 && p.y > yc - 0.55 && p.y < yc + 0.75 && !(Math.abs(p.x) < 0.035 && p.y > yc - 0.1) ? C.glass : undefined),
    // Cabin side windows and the sliding door outline.
    (p) => (Math.abs(p.x) > p.hw * 0.5 && inRounded(p.z - 0.55, p.y - (yc + 0.22), 0.45, 0.32, 3) ? C.glass : undefined),
    (p) => (Math.abs(p.x) > p.hw * 0.5 && inRounded(p.z + 0.55, p.y - (yc + 0.22), 0.4, 0.3, 3) ? C.glass : undefined),
    (p) => {
      if (Math.abs(p.x) < p.hw * 0.5) return undefined;
      const dz = p.z - 0.0;
      const dy = p.y - (yc - 0.05);
      return inRounded(dz, dy, 1.2, 0.72, 6) && !inRounded(dz, dy, 1.16, 0.68, 6) ? C.seam : undefined;
    },
    (p) => (p.y - p.yc < -0.55 * p.r ? C.dark : undefined),
  ];
  // Engine cowling on the roof.
  b.lathe('nacelle', [[-1.9, 0.08, yc + 0.95, 1.2], [-1.4, 0.36, yc + 0.92, 1.25], [0.2, 0.42, yc + 0.92, 1.25], [1.1, 0.25, yc + 0.84, 1.3], [1.4, 0.02, yc + 0.8, 1.2]], 18);
  // Tail boom, fin with end plates, tail rotor.
  b.lathe('livery', [[-8.4, 0.16, yc + 0.95, 1], [-6.6, 0.2, yc + 0.8, 1], [-4.0, 0.3, yc + 0.6, 1], [-2.0, 0.46, yc + 0.38, 1]], 16, [0, 0, 0], { livery: 1 });
  b.loft('livery', [flat([0, yc + 0.85, -7.6], 1.1, 0.12, [1, 0, 0]), flat([0, yc + 2.3, -8.3], 0.75, 0.12, [1, 0, 0])], { livery: 1 });
  const stab = [flat([0, yc + 0.85, -6.2], 0.7, 0.12, [0, 1, 0]), flat([1.3, yc + 0.85, -6.35], 0.55, 0.12, [0, 1, 0])];
  b.loft('stab', stab);
  b.loft('stab', stab.map((s) => s.map(mirror)));
  b.disc('blur', [0.18, yc + 1.55, -8.0], 0.75, 'z', 20);
  b.tube('strut', [0, yc + 1.55, -8.0], [0.22, yc + 1.55, -8.0], 0.06, 8);
  // Main rotor: mast, hub, four blades and a faint disc.
  const hubY = yc + 1.7;
  b.tube('strut', [0, yc + 1.3, 0.2], [0, hubY, 0.2], 0.11, 10);
  b.lathe('spinner', [[-0.35, 0.02, hubY], [-0.2, 0.22, hubY], [0.2, 0.22, hubY], [0.35, 0.02, hubY]], 12, [0, 0, 0.2], { caps: false });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const d: V3 = [Math.cos(a), 0, Math.sin(a)];
    const t: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const sec = (r: number): V3[] => {
      const c: V3 = [d[0] * r, hubY + 0.05 - r * 0.004, 0.2 + d[2] * r];
      return [
        [c[0] + t[0] * 0.17, c[1], c[2] + t[2] * 0.17],
        [c[0], c[1] + 0.03, c[2]],
        [c[0] - t[0] * 0.17, c[1], c[2] - t[2] * 0.17],
        [c[0], c[1] - 0.03, c[2]],
        [c[0] + t[0] * 0.17, c[1], c[2] + t[2] * 0.17],
      ];
    };
    b.loft('blade', [sec(0.3), sec(5.5)], { smooth: false });
  }
  b.disc('blur', [0, hubY + 0.04, 0.2], 5.5, 'y', 40, 0.4);
  // Skids (fixed: not part of the retractable gear node).
  b.inGroup('fixed', () => {
    for (const sx of [1, -1]) {
      b.tube('strut', [sx * 1.05, 0.08, -1.6], [sx * 1.05, 0.08, 1.7], 0.05, 8);
      b.tube('strut', [sx * 1.05, 0.08, 1.7], [sx * 1.0, 0.25, 2.0], 0.05, 8);
      for (const z of [-1.0, 1.0]) b.tube('strut', [sx * 1.05, 0.08, z], [sx * 0.65, yc - 0.75, z], 0.045, 8);
    }
  });
  b.sphere('navRed', [0.95, yc + 0.85, -6.3], 0.06);
  b.sphere('navGreen', [-0.95, yc + 0.85, -6.3], 0.06);
  b.sphere('navRed', [0, yc + 1.25, -1.2], 0.07);
  return { b, textures: { fus: paintLathe(1024, 256, st, -2.2, 3.0, layers, C.white) }, length: 13.6, span: 11, height: 4, lights: { tip: [-6.3, 0.95, yc + 0.85], tail: [-8.4, 0, yc + 1.0], top: [-1.2, 0, yc + 1.3], belly: [0.5, 0, yc - 0.95], land: [2.6, 0.3, yc - 0.6] } };
}

export function buildLight(highWing: boolean): Built {
  const b = new Builder();
  const yc = highWing ? 1.25 : 1.05;
  const st: Station[] = [
    [-4.3, 0.07, yc + 0.36, 1],
    [-3.2, 0.24, yc + 0.27, 0.95],
    [-1.6, 0.48, yc + 0.12, 0.9],
    [-0.6, 0.6, yc + 0.06, 0.88],
    [0.9, 0.64, yc + 0.06, 0.85],
    [1.9, 0.56, yc - 0.02, 0.85],
    [2.9, 0.44, yc - 0.06, 0.92],
    [3.55, 0.32, yc - 0.06, 0.95],
    [3.75, 0.2, yc - 0.06, 1],
  ];
  b.lathe('fuselage', st, 22, [0, 0, 0], { uZ0: -4.3, uZ1: 3.75, livery: 0.25 });
  const poly: [number, number][] = [
    [1.85, yc + 0.18],
    [0.95, yc + 0.58],
    [-0.75, yc + 0.6],
    [-1.05, yc + 0.15],
  ];
  const layers: Layer[] = [
    (p) => (inPoly(poly, p.z, p.y) && !(Math.abs(p.z - 0.85) < 0.04 || Math.abs(p.z + 0.15) < 0.04 || (Math.abs(p.x) < 0.03 && p.z > 0.95)) ? C.glass : undefined),
    (p) => (Math.abs(p.y - (yc - 0.12)) < 0.06 && p.z < 2.6 && Math.abs(p.x) > p.hw * 0.6 ? C.stripe : undefined),
  ];
  // Cowling and spinner + two-blade propeller.
  b.lathe('spinner', [[3.75, 0.16, yc - 0.06], [3.95, 0.12, yc - 0.06], [4.15, 0.01, yc - 0.06]], 14, [0, 0, 0], { caps: false });
  for (const sgn of [1, -1]) {
    b.loft('blade', [flat([0, yc - 0.06 + sgn * 0.12, 3.92], 0.16, 0.12, [0, 0, 1]), flat([0, yc - 0.06 + sgn * 0.95, 3.9], 0.1, 0.12, [0, 0, 1])], { smooth: false });
  }
  b.disc('blur', [0, yc - 0.06, 3.88], 0.95, 'z', 28, 0.15);
  // Wing.
  const wy = highWing ? yc + 0.62 : yc - 0.52;
  const span = highWing ? 5.5 : 5.35;
  const wing = [flat([0, wy, 1.05], 1.6, 0.15, [0, 1, 0]), flat([2.6, wy + (highWing ? 0.03 : 0.12), 1.05], 1.6, 0.14, [0, 1, 0]), flat([span, wy + (highWing ? 0.08 : 0.34), 0.9], 1.15, 0.12, [0, 1, 0])];
  b.loft('wing', wing);
  b.loft('wing', wing.map((s) => s.map(mirror)));
  if (highWing) for (const sx of [1, -1]) b.tube('strut', [sx * 0.55, yc - 0.45, 0.4], [sx * 2.9, wy - 0.05, 0.3], 0.045, 8);
  // Tail.
  const fin = [flat([0, yc + 0.3, -2.9], 1.45, 0.1, [1, 0, 0]), flat([0, yc + 1.55, -3.85], 0.75, 0.1, [1, 0, 0])];
  b.loft('livery', fin, { livery: 1 });
  const stab = [flat([0, yc + 0.28, -3.35], 0.95, 0.1, [0, 1, 0]), flat([1.7, yc + 0.28, -3.6], 0.7, 0.1, [0, 1, 0])];
  b.loft('stab', stab);
  b.loft('stab', stab.map((s) => s.map(mirror)));
  // Fixed tricycle gear.
  b.inGroup('fixed', () => {
    b.tube('strut', [0, yc - 0.5, 2.6], [0, 0.2, 2.75], 0.04, 8);
    b.cylinderX('tire', [0, 0.2, 2.75], 0.2, 0.12, 12);
    for (const sx of [1, -1]) {
      b.tube('strut', [sx * 0.35, yc - 0.55, 0.3], [sx * 1.15, 0.24, 0.25], 0.04, 8);
      b.cylinderX('tire', [sx * 1.2, 0.24, 0.25], 0.24, 0.14, 12);
    }
  });
  b.sphere('navRed', [span + 0.03, wing[2][0][1], 0.9], 0.04);
  b.sphere('navGreen', [-span - 0.03, wing[2][0][1], 0.9], 0.04);
  b.sphere('navRed', [0, yc + 1.58, -3.9], 0.04);
  return { b, textures: { fus: paintLathe(1024, 256, st, -4.3, 3.75, layers, C.white) }, length: 8.3, span: span * 2, height: 2.7, lights: { tip: [0.9, span, wy + 0.2], tail: [-4.3, 0, yc + 0.4], top: [-3.6, 0, yc + 1.6], belly: [0.5, 0, yc - 0.65], land: [1.0, span * 0.55, wy] } };
}
