/**
 * Paints a lathe's texture in surface space: every texel is mapped back to the 3D point it covers (same mapping the
 * lathe uses for its UVs), so windows, doors and windscreens can be described in metres on the real fuselage shape.
 */
import { Texture, type RGB, type Station } from './core';

export interface SurfacePoint {
  /** Position in model metres (x = left, y = up, z = forward). */
  x: number;
  y: number;
  z: number;
  /** Profile at this z: vertical half-height, centre height, half-width. */
  r: number;
  yc: number;
  hw: number;
  /** Angle around the section (0 = +X / left side, π/2 = top). */
  ang: number;
}

/** Returns a colour for the point, or undefined to fall through to the next layer. */
export type Layer = (p: SurfacePoint) => RGB | undefined;

export function profileAt(st: Station[], z: number): { r: number; yc: number; hw: number } {
  if (z <= st[0][0]) return { r: st[0][1], yc: st[0][2] ?? 0, hw: st[0][1] * (st[0][3] ?? 1) };
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (z <= b[0]) {
      const t = b[0] === a[0] ? 0 : (z - a[0]) / (b[0] - a[0]);
      const r = a[1] + (b[1] - a[1]) * t;
      const yc = (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t;
      const hwA = a[1] * (a[3] ?? 1);
      const hwB = b[1] * (b[3] ?? 1);
      return { r, yc, hw: hwA + (hwB - hwA) * t };
    }
  }
  const l = st[st.length - 1];
  return { r: l[1], yc: l[2] ?? 0, hw: l[1] * (l[3] ?? 1) };
}

/**
 * Paint a w×h texture for a lathe built with these stations and u range. `layers` are tried top-first; `base` is
 * used where none answers. 2×2 supersampling smooths window and windscreen edges.
 */
export function paintLathe(w: number, h: number, st: Station[], uZ0: number, uZ1: number, layers: Layer[], base: RGB, ss = 2): Texture {
  const tex = new Texture(w, h, base);
  const angCos = new Float64Array(h * ss);
  const angSin = new Float64Array(h * ss);
  for (let j = 0; j < h * ss; j++) {
    const a = ((j + 0.5) / (h * ss)) * Math.PI * 2;
    angCos[j] = Math.cos(a);
    angSin[j] = Math.sin(a);
  }
  const p: SurfacePoint = { x: 0, y: 0, z: 0, r: 0, yc: 0, hw: 0, ang: 0 };
  const acc = [0, 0, 0];
  for (let x = 0; x < w; x++) {
    const profiles = [];
    for (let sx = 0; sx < ss; sx++) {
      const z = uZ0 + ((x + (sx + 0.5) / ss) / w) * (uZ1 - uZ0);
      profiles.push({ z, ...profileAt(st, z) });
    }
    for (let y = 0; y < h; y++) {
      acc[0] = acc[1] = acc[2] = 0;
      for (let sx = 0; sx < ss; sx++) {
        const pr = profiles[sx];
        for (let sy = 0; sy < ss; sy++) {
          const j = y * ss + sy;
          p.z = pr.z;
          p.r = pr.r;
          p.yc = pr.yc;
          p.hw = pr.hw;
          p.x = angCos[j] * pr.hw;
          p.y = pr.yc + angSin[j] * pr.r;
          p.ang = ((j + 0.5) / (h * ss)) * Math.PI * 2;
          let c: RGB | undefined;
          for (const layer of layers) {
            c = layer(p);
            if (c) break;
          }
          c ??= base;
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const n = ss * ss;
      const k = (y * w + x) * 3;
      tex.data[k] = Math.round(acc[0] / n);
      tex.data[k + 1] = Math.round(acc[1] / n);
      tex.data[k + 2] = Math.round(acc[2] / n);
    }
  }
  return tex;
}

/** Point-in-polygon for 2D points [a, b]. */
export function inPoly(pts: [number, number][], a: number, b: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ai, bi] = pts[i];
    const [aj, bj] = pts[j];
    if (bi > b !== bj > b && a < ((aj - ai) * (b - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
}

/** Superellipse test (rounded rectangle / oval). */
export function inRounded(dx: number, dy: number, hw: number, hh: number, n = 2.6): boolean {
  return Math.abs(dx / hw) ** n + Math.abs(dy / hh) ** n <= 1;
}
