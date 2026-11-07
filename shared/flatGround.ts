import { haversineM } from './geo';

/** The flat 2D map sits this far below each 3D airport's ground so the airport's edge always covers the seam. */
export const PLANE_DROP_M = 3;

export interface GroundArea {
  lat: number;
  lon: number;
  /** Ground height of the 3D airport (ellipsoid metres). */
  groundM: number;
  /** Radius of the airport's 3D area, metres. */
  radiusM: number;
}

/**
 * Height of the flat 2D map at a point: exactly the airport's ground (minus PLANE_DROP_M) within 2 km of its 3D area,
 * blended between airports by inverse squared distance further out, 0 (the ellipsoid) when there are none.
 */
export function flatGroundHeight(areas: readonly GroundArea[], lat: number, lon: number): number {
  let ws = 0;
  let hs = 0;
  for (const a of areas) {
    const d = haversineM(a.lat, a.lon, lat, lon) - a.radiusM - 2000;
    if (d <= 0) return a.groundM - PLANE_DROP_M;
    const w = 1 / (d * d + 1e6);
    ws += w;
    hs += w * a.groundM;
  }
  return ws ? hs / ws - PLANE_DROP_M : 0;
}
