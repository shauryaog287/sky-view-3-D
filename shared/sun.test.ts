import { describe, expect, it } from 'vitest';
import { skyTone, solarElevationDeg } from './sun';

describe('sun', () => {
  it('Delhi: high at local noon, below the horizon before dawn', () => {
    // 2026-11-07 06:45 UTC ≈ 12:15 IST (solar noon in Delhi is ~12:05 IST in early November).
    const noon = solarElevationDeg(28.6, 77.2, Date.UTC(2026, 10, 7, 6, 45));
    expect(noon).toBeGreaterThan(40);
    expect(noon).toBeLessThan(48);
    const predawn = solarElevationDeg(28.6, 77.2, Date.UTC(2026, 10, 7, 0, 0)); // 05:30 IST
    expect(predawn).toBeLessThan(0);
    const midnight = solarElevationDeg(28.6, 77.2, Date.UTC(2026, 10, 6, 18, 30));
    expect(midnight).toBeLessThan(-30);
  });

  it('tones go day → golden → twilight → night', () => {
    expect(skyTone(30).phase).toBe('day');
    expect(skyTone(5).phase).toBe('golden');
    expect(skyTone(-4).phase).toBe('twilight');
    expect(skyTone(-20)).toMatchObject({ phase: 'night', brightness: 0.3 });
    // Continuous at the boundaries.
    expect(skyTone(11.999).brightness).toBeCloseTo(skyTone(12).brightness, 2);
    expect(skyTone(-0.001).brightness).toBeCloseTo(skyTone(0).brightness, 2);
  });
});
