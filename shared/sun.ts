/** Solar position (low-precision almanac, ±0.5°) — enough for lighting, day/night and golden-hour tinting. */
const D2R = Math.PI / 180;

export function solarElevationDeg(lat: number, lon: number, ms: number): number {
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstH = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const ha = (gmstH * 15 + lon) * D2R - ra;
  const latR = lat * D2R;
  return Math.asin(Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(ha)) / D2R;
}

export interface SkyTone {
  /** Multiplier for photoreal tile colours (they have baked daylight). */
  brightness: number;
  /** RGB tint applied with the brightness. */
  tint: [number, number, number];
  phase: 'day' | 'golden' | 'twilight' | 'night';
}

/** Map solar elevation to a tile tone: full daylight, warm golden hour, blue twilight, dim night. */
export function skyTone(elevDeg: number): SkyTone {
  if (elevDeg >= 12) return { brightness: 1, tint: [1, 1, 1], phase: 'day' };
  if (elevDeg >= 0) {
    const k = elevDeg / 12;
    return { brightness: 0.82 + 0.18 * k, tint: [1, 0.86 + 0.14 * k, 0.72 + 0.28 * k], phase: 'golden' };
  }
  if (elevDeg >= -8) {
    const k = (elevDeg + 8) / 8;
    return { brightness: 0.32 + 0.5 * k, tint: [0.62 + 0.38 * k, 0.68 + 0.18 * k, 0.9 - 0.18 * k], phase: 'twilight' };
  }
  return { brightness: 0.3, tint: [0.6, 0.67, 0.92], phase: 'night' };
}
