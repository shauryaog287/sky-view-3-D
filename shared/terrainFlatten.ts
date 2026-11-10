/**
 * Airport flattening for the elevation model: real airfields are graded flat, but 30 m elevation data is noisy and
 * knows nothing about runways. Inside an airport's outline the terrain is set to the published field elevation and
 * blended back into the surrounding terrain over BLEND_M, so runways, aprons and scenery sit on clean ground while
 * hills, valleys and table-top drops around the airport stay real.
 */
import { enuOffsetM } from './geo';
import { convexHull } from './airport3d';

export const FLATTEN_BUFFER_M = 900;
export const BLEND_M = 700;

export interface FlatSite {
  lat: number;
  lon: number;
  /** Field elevation, metres. */
  elevM: number;
  /** Convex outline in local east/north metres around (lat, lon), counter-clockwise. */
  hull: [number, number][];
  /** Farthest hull vertex from the reference point, metres. */
  radiusM: number;
}

/** Outline to flatten for an airport: its runways grown by FLATTEN_BUFFER_M (a disc for airports without runway data). */
export function flatSite(airport: { lat: number; lon: number; elevFt: number; runways: { le: { lat: number; lon: number }; he: { lat: number; lon: number } }[] }): FlatSite {
  const pts: [number, number][] = [];
  const ring = (x: number, y: number, r: number) => {
    for (let k = 0; k < 12; k++) pts.push([x + Math.cos((k * Math.PI) / 6) * r, y + Math.sin((k * Math.PI) / 6) * r]);
  };
  for (const r of airport.runways) {
    for (const e of [r.le, r.he]) {
      const o = enuOffsetM(airport.lat, airport.lon, e.lat, e.lon);
      ring(o.east, o.north, FLATTEN_BUFFER_M);
    }
  }
  if (!pts.length) ring(0, 0, 600);
  const hull = convexHull(pts);
  return { lat: airport.lat, lon: airport.lon, elevM: airport.elevFt * 0.3048, hull, radiusM: Math.max(...hull.map(([x, y]) => Math.hypot(x, y))) };
}

/** Distance from a point to a convex counter-clockwise polygon: ≤ 0 inside, metres outside (exact near edges). */
export function distanceOutside(hull: [number, number][], x: number, y: number): number {
  let d = -Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    // Outward normal of a CCW edge is (ey, −ex).
    d = Math.max(d, ((x - a[0]) * ey - (y - a[1]) * ex) / len);
  }
  return d;
}

/** 1 inside the outline, smoothly down to 0 at BLEND_M outside it. */
export function flattenWeight(distOutsideM: number): number {
  if (distOutsideM <= 0) return 1;
  if (distOutsideM >= BLEND_M) return 0;
  const t = 1 - distOutsideM / BLEND_M;
  return t * t * (3 - 2 * t);
}

/** Terrain height at a point after flattening for the given sites (strongest site wins). */
export function flattenHeight(h: number, lat: number, lon: number, sites: readonly FlatSite[]): number {
  let best = 0;
  let elev = h;
  for (const s of sites) {
    const o = enuOffsetM(s.lat, s.lon, lat, lon);
    if (Math.hypot(o.east, o.north) > s.radiusM + BLEND_M) continue;
    const w = flattenWeight(distanceOutside(s.hull, o.east, o.north));
    if (w > best) {
      best = w;
      elev = s.elevM;
    }
  }
  return best > 0 ? h + (elev - h) * best : h;
}

/** Terrarium PNG pixel → metres above sea level. */
export function terrariumHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}
