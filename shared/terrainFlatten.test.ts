import { describe, expect, it } from 'vitest';
import { BLEND_M, FLATTEN_BUFFER_M, distanceOutside, flatSite, flattenHeight, flattenWeight, terrariumHeight } from './terrainFlatten';
import { destinationPoint } from './geo';

// Mangaluru: a table-top runway (09/27, ~2.4 km) at about 100 m, with steep drops around it.
const IXE = { lat: 12.9613, lon: 74.8901, elevFt: 337, runways: [{ le: { lat: 12.9617, lon: 74.8789 }, he: { lat: 12.9608, lon: 74.9013 } }] };

describe('airport flattening', () => {
  const site = flatSite(IXE);

  it('builds a convex outline around the runway', () => {
    expect(site.hull.length).toBeGreaterThan(6);
    expect(distanceOutside(site.hull, 0, 0)).toBeLessThan(-FLATTEN_BUFFER_M * 0.9);
    const d = distanceOutside(site.hull, 0, FLATTEN_BUFFER_M + 250);
    expect(d).toBeGreaterThan(230);
    expect(d).toBeLessThan(290);
    expect(site.elevM).toBeCloseTo(102.7, 0);
  });

  it('sets the field elevation on the airport and keeps the real terrain away from it', () => {
    expect(flattenHeight(60, IXE.lat, IXE.lon, [site])).toBeCloseTo(site.elevM, 5);
    const end = IXE.runways[0].le;
    expect(flattenHeight(140, end.lat, end.lon, [site])).toBeCloseTo(site.elevM, 5);
    const far = destinationPoint(IXE.lat, IXE.lon, 0, FLATTEN_BUFFER_M + BLEND_M + 300);
    expect(flattenHeight(20, far.lat, far.lon, [site])).toBe(20);
  });

  it('blends smoothly in between', () => {
    const mid = destinationPoint(IXE.lat, IXE.lon, 0, FLATTEN_BUFFER_M + BLEND_M / 2);
    const h = flattenHeight(20, mid.lat, mid.lon, [site]);
    expect(h).toBeGreaterThan(40);
    expect(h).toBeLessThan(90);
    expect(flattenWeight(0)).toBe(1);
    expect(flattenWeight(BLEND_M)).toBe(0);
    expect(flattenWeight(BLEND_M / 2)).toBeCloseTo(0.5, 5);
  });

  it('decodes terrarium pixels', () => {
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    expect(terrariumHeight(134, 44, 128)).toBeCloseTo(1580.5, 5);
  });
});
