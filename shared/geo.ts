/** Geodesy helpers. Spherical-earth formulas: accurate to ~0.3 % which is plenty for display and prediction. */

export const EARTH_RADIUS_M = 6_371_008.8;
export const FT_TO_M = 0.3048;
export const M_TO_FT = 1 / FT_TO_M;
export const KT_TO_MS = 0.514444;
export const MS_TO_KT = 1 / KT_TO_MS;
export const NM_TO_M = 1852;
export const FPM_TO_MS = FT_TO_M / 60;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const toRad = (d: number) => d * D2R;
export const toDeg = (r: number) => r * R2D;

/** Normalise any angle in degrees to [0, 360). */
export function norm360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Signed smallest difference b − a in degrees, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = norm360(b) - norm360(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Wrap a longitude into [−180, 180). */
export function wrapLon(lon: number): number {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return l;
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = (lat2 - lat1) * D2R;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing from point 1 to point 2, degrees [0, 360). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) * R2D);
}

/** Point reached travelling `distM` metres from (lat, lon) on initial bearing `brgDeg`. */
export function destinationPoint(lat: number, lon: number, brgDeg: number, distM: number): { lat: number; lon: number } {
  const d = distM / EARTH_RADIUS_M;
  const b = brgDeg * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sinP2)));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sinP2);
  return { lat: p2 * R2D, lon: wrapLon(l2 * R2D) };
}

/**
 * Small-offset conversion: east/north metres → lat/lon degrees around a reference point.
 * Valid for offsets of a few tens of km, which is all dead reckoning ever needs.
 */
export function offsetLatLon(lat: number, lon: number, eastM: number, northM: number): { lat: number; lon: number } {
  const dLat = (northM / EARTH_RADIUS_M) * R2D;
  const cosLat = Math.max(1e-6, Math.cos(lat * D2R));
  const dLon = (eastM / (EARTH_RADIUS_M * cosLat)) * R2D;
  return { lat: lat + dLat, lon: wrapLon(lon + dLon) };
}

/** Inverse of offsetLatLon: east/north metres of point 2 relative to point 1 (local flat approximation). */
export function enuOffsetM(lat1: number, lon1: number, lat2: number, lon2: number): { east: number; north: number } {
  const north = (lat2 - lat1) * D2R * EARTH_RADIUS_M;
  let dLon = lon2 - lon1;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const east = dLon * D2R * EARTH_RADIUS_M * Math.cos(((lat1 + lat2) / 2) * D2R);
  return { east, north };
}

/**
 * Cross-track and along-track distance of point P relative to a line through A with bearing `brg`.
 * Positive cross-track = right of the line. Flat approximation, fine within ~50 km.
 */
export function trackOffsets(
  aLat: number,
  aLon: number,
  brgDeg: number,
  pLat: number,
  pLon: number,
): { along: number; cross: number } {
  const { east, north } = enuOffsetM(aLat, aLon, pLat, pLon);
  const b = brgDeg * D2R;
  const ux = Math.sin(b); // unit vector along bearing (east, north)
  const uy = Math.cos(b);
  const along = east * ux + north * uy;
  const cross = east * uy - north * ux;
  return { along, cross };
}

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function bboxCenter(b: BBox): { lat: number; lon: number } {
  let maxLon = b.maxLon;
  if (maxLon < b.minLon) maxLon += 360; // crosses antimeridian
  return { lat: (b.minLat + b.maxLat) / 2, lon: wrapLon((b.minLon + maxLon) / 2) };
}

export function inBBox(b: BBox, lat: number, lon: number): boolean {
  if (lat < b.minLat || lat > b.maxLat) return false;
  if (b.minLon <= b.maxLon) return lon >= b.minLon && lon <= b.maxLon;
  return lon >= b.minLon || lon <= b.maxLon; // antimeridian
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate an angle in degrees along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return norm360(a + angleDiff(a, b) * t);
}

/** Smoothstep easing on [0, 1]. */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
