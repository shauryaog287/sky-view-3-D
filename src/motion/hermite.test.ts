import { describe, expect, it } from 'vitest';
import { HermiteTrack } from './hermite';
import { destinationPoint, haversineM, KT_TO_MS } from '../../shared/geo';
import type { TrackPoint } from '../../shared/types';

function straightTrack(n: number, stepS: number, gs = 300, track = 90): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = destinationPoint(20, 75, track, gs * KT_TO_MS * stepS * i);
    out.push({ hex: 'abc', ts: i * stepS * 1000, lat: p.lat, lon: p.lon, alt: 30000 - i * 100, gs, track, vrate: -400 });
  }
  return out;
}

describe('HermiteTrack (replay)', () => {
  it('passes exactly through the samples', () => {
    const pts = straightTrack(10, 15);
    const h = new HermiteTrack(pts);
    for (const p of pts) {
      const a = h.at(p.ts);
      expect(haversineM(a.lat, a.lon, p.lat, p.lon)).toBeLessThan(0.5);
      expect(a.altM! / 0.3048).toBeCloseTo(p.alt!, 3);
    }
  });

  it('interpolates straight flight at constant speed between samples', () => {
    const h = new HermiteTrack(straightTrack(5, 15));
    const mid = h.at(22_500);
    const exp = destinationPoint(20, 75, 90, 300 * KT_TO_MS * 22.5);
    expect(haversineM(mid.lat, mid.lon, exp.lat, exp.lon)).toBeLessThan(3);
    expect(h.pose(22_500).heading).toBeCloseTo(90, 0);
    expect(h.pose(22_500).vrateFpm).toBeCloseTo(-400, -1);
  });

  it('follows a turn smoothly using recorded tracks (no corner cutting)', () => {
    // Quarter circle of radius 5 km sampled every 30 s.
    const pts: TrackPoint[] = [];
    const r = 5000;
    const v = (r * (Math.PI / 8)) / 52.36; // arc length per 52.36 s segment → ≈ 37.5 m/s
    for (let i = 0; i <= 4; i++) {
      const ang = (i / 4) * (Math.PI / 2); // heading from 0 (north) to 90 (east), centre to the east
      const east = r - r * Math.cos(ang);
      const north = r * Math.sin(ang);
      const lat = 20 + north / 111_195;
      const lon = 75 + east / (111_195 * Math.cos((20 * Math.PI) / 180));
      pts.push({ hex: 'x', ts: i * 52_360, lat, lon, alt: 5000, gs: v / KT_TO_MS, track: (ang * 180) / Math.PI, vrate: 0 });
    }
    const h = new HermiteTrack(pts);
    // Midway through a segment the interpolated point should stay close to the circle.
    for (const t of [26_180, 78_540, 130_900]) {
      const a = h.at(t);
      const east = (a.lon - 75) * 111_195 * Math.cos((20 * Math.PI) / 180);
      const north = (a.lat - 20) * 111_195;
      const dist = Math.hypot(east - r, north);
      expect(Math.abs(dist - r)).toBeLessThan(40);
    }
  });

  it('interpolates linearly across long data gaps and clamps outside the range', () => {
    const pts = straightTrack(3, 15);
    pts[2] = { ...pts[2], ts: 600_000 }; // 10-minute gap
    const h = new HermiteTrack(pts, 120);
    const a = h.at(307_500);
    expect(Number.isFinite(a.lat)).toBe(true);
    expect(h.at(-5).lat).toBe(pts[0].lat);
    expect(h.at(10_000_000).lat).toBe(pts[2].lat);
  });
});
