import { describe, expect, it } from 'vitest';
import { AIRLINES } from './airlines';
import { PAINT_SCHEMES, paintSchemeFor } from './liveries';

describe('airline paint schemes', () => {
  it('has designed schemes for the main Indian operators', () => {
    for (const code of ['IGO', 'AIC', 'AXB', 'AKJ', 'SEJ']) expect(PAINT_SCHEMES[code], code).toBeDefined();
    expect(paintSchemeFor('igo')).toMatchObject({ tail: '#1d3b8f', belly: '#1d3b8f' });
  });

  it('falls back to the brand colour on the tail, or nothing', () => {
    const plain = AIRLINES.find((a) => a.color && !PAINT_SCHEMES[a.icao]);
    if (plain) expect(paintSchemeFor(plain.icao)).toEqual({ tail: plain.color });
    expect(paintSchemeFor('ZZZ')).toBeUndefined();
    expect(paintSchemeFor(undefined)).toBeUndefined();
  });

  it('uses valid colours and sensible sweep amounts', () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const [code, s] of Object.entries(PAINT_SCHEMES)) {
      for (const c of [s.tail, s.tail2, s.body, s.belly, s.cheat, s.engine, s.sweep?.[0]]) if (c !== undefined) expect(c, code).toMatch(hex);
      if (s.sweep) {
        expect(s.sweep[1], code).toBeGreaterThan(0.03);
        expect(s.sweep[1], code).toBeLessThan(0.3);
      }
    }
  });
});
