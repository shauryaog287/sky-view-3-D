import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  bearingDeg,
  destinationPoint,
  enuOffsetM,
  haversineM,
  inBBox,
  lerpAngle,
  norm360,
  offsetLatLon,
  trackOffsets,
  wrapLon,
} from './geo';

describe('geo', () => {
  it('normalises and diffs angles', () => {
    expect(norm360(-10)).toBe(350);
    expect(norm360(725)).toBe(5);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(wrapLon(190)).toBe(-170);
  });

  it('computes DEL → BOM distance and bearing', () => {
    // VIDP ↔ VABB ≈ 1,148 km
    const d = haversineM(28.5665, 77.1031, 19.0887, 72.8679);
    expect(d / 1000).toBeGreaterThan(1130);
    expect(d / 1000).toBeLessThan(1160);
    const b = bearingDeg(28.5665, 77.1031, 19.0887, 72.8679);
    expect(b).toBeGreaterThan(195);
    expect(b).toBeLessThan(210);
  });

  it('destinationPoint is the inverse of distance/bearing', () => {
    const p = destinationPoint(12.95, 77.66, 93, 25_000);
    expect(haversineM(12.95, 77.66, p.lat, p.lon)).toBeCloseTo(25_000, -1);
    expect(bearingDeg(12.95, 77.66, p.lat, p.lon)).toBeCloseTo(93, 0);
  });

  it('local ENU offsets round-trip', () => {
    const p = offsetLatLon(28.5, 77.1, 1200, -800);
    const o = enuOffsetM(28.5, 77.1, p.lat, p.lon);
    expect(o.east).toBeCloseTo(1200, 0);
    expect(o.north).toBeCloseTo(-800, 0);
  });

  it('track offsets: right of course is positive cross-track', () => {
    const right = offsetLatLon(0, 0, 100, 1000); // heading north, 100 m east
    const o = trackOffsets(0, 0, 0, right.lat, right.lon);
    expect(o.along).toBeCloseTo(1000, 0);
    expect(o.cross).toBeCloseTo(100, 0);
  });

  it('bbox across antimeridian', () => {
    const b = { minLat: -10, maxLat: 10, minLon: 170, maxLon: -170 };
    expect(inBBox(b, 0, 175)).toBe(true);
    expect(inBBox(b, 0, -175)).toBe(true);
    expect(inBBox(b, 0, 0)).toBe(false);
  });
});
