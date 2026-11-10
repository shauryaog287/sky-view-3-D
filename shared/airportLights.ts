/**
 * Airfield lighting layout (ICAO Annex 14 style, simplified): what a pilot or spotter sees at night.
 *  - runway edge lights (white, amber over the last 600 m), threshold bars (green) and runway end bars (red);
 *  - centreline lights (white, alternating red/white from 900 m to go, red for the last 300 m) and touchdown-zone
 *    barrettes on long runways of large airports;
 *  - approach lighting: centreline barrettes, a crossbar at 300 m and sequenced flashers ("the rabbit");
 *  - PAPI: four units left of the runway that read white/red by the viewer's glide angle (2 white = on the 3° path);
 *  - taxiway centreline (green) and edge (blue) lights, apron floodlight masts, red obstruction lights on tall
 *    structures and the aerodrome beacon on the tower.
 * Directional lights carry two colours: one for a viewer on the "A" side of the runway (approaching its low-numbered
 * end) and one for the other side. Pure layout in local metres (x east, y north, z up from the airfield surface).
 */
import type { Airport3D } from './airport3d';
import { enuOffsetM } from './geo';

export const LIGHT = { OFF: 0, WHITE: 1, WARM: 2, RED: 3, GREEN: 4, BLUE: 5, AMBER: 6, FLOOD: 7 } as const;
/** rgb per LIGHT colour. */
export const LIGHT_RGB: [number, number, number][] = [
  [0, 0, 0],
  [255, 250, 235],
  [255, 226, 170],
  [255, 46, 36],
  [60, 255, 120],
  [70, 120, 255],
  [255, 176, 40],
  [255, 232, 190],
];

export interface AirfieldLight {
  x: number;
  y: number;
  z: number;
  /** Colour for a viewer on side A / side B of its runway (the same for non-directional lights). */
  a: number;
  b: number;
  /** Size class: 1 small (taxiway), 2 runway, 3 strong (approach flashers, floods). */
  size: number;
  /** Runway index for directional lights and PAPI, else −1. */
  rw: number;
  /** Flash: period (s) and phase (0–1); 0 period = steady. */
  period: number;
  phase: number;
  /** PAPI unit 0–3 (0 nearest the runway) when ≥ 0; `end` tells which runway end it serves. */
  papi: number;
  end: 0 | 1;
  /** Shown in daylight too (PAPI, flashers). */
  day: boolean;
}

export interface LightRunway {
  /** Mid point and unit axis from end A to end B. */
  mx: number;
  my: number;
  ax: number;
  ay: number;
  length: number;
  /** Aiming points of the two PAPIs (A end, B end). */
  papi: [{ x: number; y: number } | null, { x: number; y: number } | null];
}

export interface AirfieldLighting {
  lights: AirfieldLight[];
  runways: LightRunway[];
}

interface RunwayIn {
  le: { lat: number; lon: number; displacedFt: number };
  he: { lat: number; lon: number; displacedFt: number };
  lengthFt: number;
  widthFt: number;
  lighted?: boolean;
}

const FT = 0.3048;

/** PAPI unit k (0 nearest the runway) shows white above this glide angle, red below (3° path: two white, two red). */
export const PAPI_ANGLES_DEG = [3.5, 3.17, 2.83, 2.5];

export function papiColour(unit: number, glideAngleDeg: number): number {
  return glideAngleDeg > PAPI_ANGLES_DEG[unit] ? LIGHT.WHITE : LIGHT.RED;
}

/** Floodlight masts along the terminal side of the aprons, where none are mapped. */
export function apronMasts(a: Airport3D): { x: number; y: number; h: number }[] {
  const mapped = (a.masts ?? []).filter((m) => m.h >= 12);
  if (mapped.length >= 8) return [];
  const corners: [number, number][] = [];
  for (const b of a.buildings) {
    if (b.k === 'roof' || b.h < 6) continue;
    for (let i = 0; i < b.ring.length; i += 2) corners.push([b.ring[i], b.ring[i + 1]]);
  }
  const out: { x: number; y: number; h: number }[] = [];
  const far = (x: number, y: number) => out.every((m) => Math.hypot(m.x - x, m.y - y) > 90) && mapped.every((m) => Math.hypot(m.x - x, m.y - y) > 70);
  for (const ring of a.aprons) {
    const n = ring.length / 2;
    let carry = 0;
    for (let k = 0; k < n && out.length < 60; k++) {
      const x0 = ring[k * 2];
      const y0 = ring[k * 2 + 1];
      const x1 = ring[((k + 1) % n) * 2];
      const y1 = ring[((k + 1) % n) * 2 + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = carry; d < len; d += 120) {
        const x = x0 + ((x1 - x0) * d) / len;
        const y = y0 + ((y1 - y0) * d) / len;
        // Terminal side only: a building within 60 m.
        if (far(x, y) && corners.some(([cx, cy]) => Math.abs(cx - x) < 60 && Math.abs(cy - y) < 60)) out.push({ x: Math.round(x), y: Math.round(y), h: 25 });
      }
      carry = (carry + Math.ceil(Math.max(0, len - carry) / 120) * 120 - len + 120) % 120;
    }
  }
  return out;
}

export function airfieldLighting(
  airport: { lat: number; lon: number; kind: 'L' | 'M' | 'S'; runways: RunwayIn[] },
  a: Airport3D | null | undefined,
  tops: { x: number; y: number; z: number }[] = [],
): AirfieldLighting {
  const origin: [number, number] = a?.origin ?? [airport.lat, airport.lon];
  const lights: AirfieldLight[] = [];
  const runways: LightRunway[] = [];
  const add = (x: number, y: number, z: number, ca: number, cb: number, size: number, rw = -1, extra: Partial<AirfieldLight> = {}) => {
    if (ca === LIGHT.OFF && cb === LIGHT.OFF && (extra.papi ?? -1) < 0) return;
    lights.push({ x, y, z, a: ca, b: cb, size, rw, period: 0, phase: 0, papi: -1, end: 0, day: false, ...extra });
  };
  const strips: { mx: number; my: number; ax: number; ay: number; half: number; hw: number }[] = [];

  airport.runways.forEach((r) => {
    const A0 = enuOffsetM(origin[0], origin[1], r.le.lat, r.le.lon);
    const B0 = enuOffsetM(origin[0], origin[1], r.he.lat, r.he.lon);
    let Ax = A0.east;
    let Ay = A0.north;
    let Bx = B0.east;
    let By = B0.north;
    const L = Math.hypot(Bx - Ax, By - Ay);
    if (L < 400) return;
    const ax = (Bx - Ax) / L;
    const ay = (By - Ay) / L;
    // Left of the A→B direction.
    const lx = -ay;
    const ly = ax;
    // Align sideways with the centreline traced on imagery (OpenStreetMap), when there is one for this runway.
    let shift = 0;
    let count = 0;
    let W = Math.max(18, (r.widthFt || 150) * FT);
    for (const o of a?.runways ?? []) {
      let ok = true;
      let s = 0;
      for (let i = 0; i < o.line.length && ok; i += 2) {
        const along = (o.line[i] - Ax) * ax + (o.line[i + 1] - Ay) * ay;
        const cross = (o.line[i] - Ax) * lx + (o.line[i + 1] - Ay) * ly;
        if (along < -400 || along > L + 400 || Math.abs(cross) > 70) ok = false;
        s += cross;
      }
      if (!ok) continue;
      shift += s;
      count += o.line.length / 2;
      W = Math.max(W, Math.min(o.w, 80));
    }
    if (count) {
      shift /= count;
      Ax += lx * shift;
      Ay += ly * shift;
      Bx += lx * shift;
      By += ly * shift;
    }
    const rw = runways.length;
    const big = airport.kind === 'L' && L >= 2300;
    const medium = airport.kind !== 'S' && L >= 1500;
    const at = (d: number, off: number): [number, number] => [Ax + ax * d + lx * off, Ay + ay * d + ly * off];
    const dA = Math.min(r.le.displacedFt * FT || 0, L * 0.3);
    const dB = Math.min(r.he.displacedFt * FT || 0, L * 0.3);
    strips.push({ mx: (Ax + Bx) / 2, my: (Ay + By) / 2, ax, ay, half: L / 2 + 60, hw: W / 2 + 6 });

    // Edge lights.
    const edge = W / 2 + 2;
    const nEdge = Math.max(2, Math.round(L / 60));
    for (let i = 0; i <= nEdge; i++) {
      const d = (L * i) / nEdge;
      const ca = d > L - 600 ? LIGHT.AMBER : LIGHT.WHITE;
      const cb = d < 600 ? LIGHT.AMBER : LIGHT.WHITE;
      for (const s of [-1, 1]) add(...at(d, s * edge), 0.4, ca, cb, 2, rw);
    }
    // Threshold (green from the approach side) and runway end (red from the runway side) bars, with wing bars.
    const bar = (d: number, ca: number, cb: number) => {
      const n = Math.max(6, Math.round(W / 3));
      for (let i = 0; i <= n; i++) add(...at(d, -W / 2 + (W * i) / n), 0.3, ca, cb, 2, rw);
      for (const s of [-1, 1]) for (let k = 1; k <= 4; k++) add(...at(d, s * (W / 2 + 2 + k * 2.5)), 0.3, ca, cb, 2, rw);
    };
    bar(dA, LIGHT.GREEN, LIGHT.RED);
    bar(L - dB, LIGHT.RED, LIGHT.GREEN);
    if (medium) {
      // Centreline.
      const step = big ? 15 : 30;
      const n = Math.round(L / step);
      for (let i = 1; i < n; i++) {
        const d = i * step;
        const col = (toGo: number) => (toGo < 300 ? LIGHT.RED : toGo < 900 ? (i % 2 ? LIGHT.RED : LIGHT.WHITE) : LIGHT.WHITE);
        add(...at(d, 0), 0.25, col(L - d), col(d), 1, rw);
      }
    }
    if (big) {
      // Touchdown zone barrettes: first 900 m past each threshold, visible from that approach only.
      for (let d = 60; d <= 900; d += 60) {
        for (const s of [-1, 1]) {
          for (const o of [9, 10.5, 12]) {
            add(...at(dA + d, s * o), 0.25, LIGHT.WHITE, LIGHT.OFF, 1, rw);
            add(...at(L - dB - d, s * o), 0.25, LIGHT.OFF, LIGHT.WHITE, 1, rw);
          }
        }
      }
    }
    // Approach lighting and PAPI for each end.
    const papi: LightRunway['papi'] = [null, null];
    ([0, 1] as const).forEach((end) => {
      // Local frame of this end: threshold position, direction of landing, left of the landing direction.
      const sgn = end === 0 ? 1 : -1;
      const thr = end === 0 ? dA : L - dB;
      const p = (dist: number, off: number) => at(thr - sgn * dist, sgn * off); // dist metres before the threshold
      const on = (c: number): [number, number] => (end === 0 ? [c, LIGHT.OFF] : [LIGHT.OFF, c]);
      const als = big ? 900 : medium ? 420 : 0;
      for (let dist = 30; dist <= als; dist += 30) {
        for (const o of [-3, -1.5, 0, 1.5, 3]) add(...p(dist, o), 1.2 + dist * 0.004, ...on(LIGHT.WHITE), 2, rw);
        if (dist === 300 || (big && dist === 150)) for (let o = 6; o <= (dist === 300 ? 15 : 10.5); o += 1.5) for (const s of [-1, 1]) add(...p(dist, s * o), 1.2 + dist * 0.004, ...on(LIGHT.WHITE), 2, rw);
        // Sequenced flashers run towards the threshold twice a second.
        if (big && dist >= 300) add(...p(dist, 0), 1.6 + dist * 0.004, ...on(LIGHT.WHITE), 3, rw, { period: 0.5, phase: 1 - (dist - 300) / 630 });
      }
      if (medium) {
        // PAPI: left of the runway for the landing pilot, abeam the aiming point ~300 m past the threshold.
        const aim = Math.min(300, L * 0.15);
        const [px, py] = p(-aim, 0);
        papi[end] = { x: px, y: py };
        for (let k = 0; k < 4; k++) add(...p(-aim, W / 2 + 15 + k * 9), 0.6, LIGHT.WHITE, LIGHT.WHITE, 3, rw, { papi: k, end, day: true });
      }
    });
    runways.push({ mx: (Ax + Bx) / 2, my: (Ay + By) / 2, ax, ay, length: L, papi });
  });

  if (a) {
    const onRunway = (x: number, y: number) =>
      strips.some((s) => {
        const dx = x - s.mx;
        const dy = y - s.my;
        return Math.abs(dx * s.ax + dy * s.ay) < s.half && Math.abs(-dx * s.ay + dy * s.ax) < s.hw;
      });
    // Taxiways: green centreline, blue edges on the wider ones. Spacing grows on very large airfields.
    let total = 0;
    for (const t of a.taxiways) for (let i = 0; i + 3 < t.line.length; i += 2) total += Math.hypot(t.line[i + 2] - t.line[i], t.line[i + 3] - t.line[i + 1]);
    const step = total > 120_000 ? 60 : total > 60_000 ? 45 : 30;
    for (const t of a.taxiways) {
      let carry = step / 2;
      for (let i = 0; i + 3 < t.line.length; i += 2) {
        const x0 = t.line[i];
        const y0 = t.line[i + 1];
        const dx = t.line[i + 2] - x0;
        const dy = t.line[i + 3] - y0;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) continue;
        let d = carry;
        for (; d < len; d += step) {
          const x = x0 + (dx * d) / len;
          const y = y0 + (dy * d) / len;
          if (onRunway(x, y)) continue;
          add(x, y, 0.2, LIGHT.GREEN, LIGHT.GREEN, 1);
          if (t.w >= 18 && Math.round(d / step) % 2 === 0) {
            const nx = (-dy / len) * (t.w / 2 + 1);
            const ny = (dx / len) * (t.w / 2 + 1);
            add(x + nx, y + ny, 0.35, LIGHT.BLUE, LIGHT.BLUE, 1);
            add(x - nx, y - ny, 0.35, LIGHT.BLUE, LIGHT.BLUE, 1);
          }
        }
        carry = d - len;
      }
    }
    // Apron floodlights: mapped masts and the synthesised ones.
    for (const m of [...(a.masts ?? []).filter((x) => x.h >= 12), ...apronMasts(a)]) add(m.x, m.y, Math.min(m.h, 60) + 0.6, LIGHT.FLOOD, LIGHT.FLOOD, 3);
  }
  // Obstruction lights on tall structures; the tallest (the tower mast) also carries the aerodrome beacon.
  const sorted = [...tops].sort((p, q) => q.z - p.z);
  sorted.forEach((t, i) => {
    add(t.x, t.y, t.z, LIGHT.RED, LIGHT.RED, 2, -1, i === 0 ? { period: 1.5, phase: 0 } : {});
    if (i === 0 && a?.towers.length) {
      add(t.x, t.y, t.z - 2, LIGHT.WHITE, LIGHT.WHITE, 3, -1, { period: 4, phase: 0 });
      add(t.x, t.y, t.z - 2, LIGHT.GREEN, LIGHT.GREEN, 3, -1, { period: 4, phase: 0.5 });
    }
  });
  return { lights, runways };
}
