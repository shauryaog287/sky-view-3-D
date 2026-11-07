import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../src/lib/tokenBucket';

describe('TokenBucket', () => {
  it('allows bursts up to capacity then refills over time', () => {
    let t = 0;
    const b = new TokenBucket(3, 1, () => t);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    expect(b.msUntil()).toBe(1000);
    t = 500;
    expect(b.tryTake()).toBe(false);
    t = 1000;
    expect(b.tryTake()).toBe(true);
    t = 100_000;
    expect(b.available).toBe(3); // capped
  });

  it('supports weighted costs (OpenSky credits)', () => {
    let t = 0;
    const b = new TokenBucket(4, 0.5, () => t);
    expect(b.tryTake(4)).toBe(true);
    expect(b.msUntil(2)).toBe(4000);
    expect(b.msUntil(5)).toBe(Infinity);
  });
});
