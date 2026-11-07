import { describe, expect, it } from 'vitest';
import { bucketFor, parseBucketId, planBuckets } from './buckets';
import { haversineM, NM_TO_M } from './geo';

describe('buckets', () => {
  it('a small view around Delhi maps to fine buckets that cover it', () => {
    const plan = planBuckets({ minLat: 28.2, maxLat: 28.9, minLon: 76.8, maxLon: 77.5 });
    expect(plan.truncated).toBe(false);
    expect(plan.buckets.length).toBeGreaterThanOrEqual(1);
    expect(plan.buckets.every((b) => b.level === 0)).toBe(true);
    const b = plan.buckets[0];
    // The cell containing DEL must reach the airport.
    expect(haversineM(b.lat, b.lon, 28.5665, 77.1031)).toBeLessThan(b.radiusNm * NM_TO_M);
  });

  it('all of India switches to coarse buckets and truncates near the centre', () => {
    const plan = planBuckets({ minLat: 6, maxLat: 36, minLon: 66, maxLon: 98 });
    expect(plan.buckets.every((b) => b.level === 1)).toBe(true);
    expect(plan.buckets.length).toBe(12);
    expect(plan.truncated).toBe(true);
    expect(plan.buckets.every((b) => b.radiusNm <= 250)).toBe(true);
  });

  it('identical views share identical bucket ids (cache sharing)', () => {
    const a = planBuckets({ minLat: 19.0, maxLat: 19.3, minLon: 72.7, maxLon: 73.0 }).buckets.map((b) => b.id);
    const b = planBuckets({ minLat: 18.9, maxLat: 19.4, minLon: 72.6, maxLon: 73.1 }).buckets.map((b) => b.id);
    expect(a[0]).toBe(b[0]);
  });

  it('round-trips ids and handles the antimeridian', () => {
    const b = bucketFor(0, 25, 89);
    expect(parseBucketId(b.id)).toEqual(b);
    const plan = planBuckets({ minLat: -18, maxLat: -16, minLon: 178.5, maxLon: -178.5 });
    expect(plan.buckets.length).toBeGreaterThanOrEqual(2);
    for (const bk of plan.buckets) expect(Math.abs(bk.lon)).toBeGreaterThan(170);
  });
});
