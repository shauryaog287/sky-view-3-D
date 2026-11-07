import { describe, expect, it } from 'vitest';
import { flatGroundHeight, PLANE_DROP_M } from './flatGround';

const DEL = { lat: 28.5665, lon: 77.1031, groundM: 185, radiusM: 4000 };
const BLR = { lat: 13.1986, lon: 77.7066, groundM: 830, radiusM: 4500 };

describe('flat 2D ground around 3D airports', () => {
  it('sits just under the airport near it', () => {
    expect(flatGroundHeight([DEL, BLR], 28.5665, 77.1031)).toBe(185 - PLANE_DROP_M);
    expect(flatGroundHeight([DEL, BLR], 28.6, 77.13)).toBe(185 - PLANE_DROP_M); // ~5 km away: still the airport level
    expect(flatGroundHeight([DEL, BLR], 13.2, 77.7)).toBe(830 - PLANE_DROP_M);
  });

  it('blends smoothly between airports and is flat ground with none', () => {
    const mid = flatGroundHeight([DEL, BLR], 20.9, 77.4);
    expect(mid).toBeGreaterThan(185);
    expect(mid).toBeLessThan(830);
    const nearDel = flatGroundHeight([DEL, BLR], 27.5, 77.2);
    expect(nearDel).toBeLessThan(mid);
    expect(flatGroundHeight([], 28.5, 77)).toBe(0);
  });
});
