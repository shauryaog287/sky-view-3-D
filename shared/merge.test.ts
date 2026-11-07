import { describe, expect, it } from 'vitest';
import { dropStale, mergeAircraft } from './merge';
import { parseReadsbResponse } from './readsb';
import type { AircraftState } from './types';
import DEL from '../fixtures/adsb-v2/DEL.json';

const base = (o: Partial<AircraftState>): AircraftState => ({
  hex: 'abc123',
  lat: 28,
  lon: 77,
  onGround: false,
  posTs: 1000,
  seenTs: 1000,
  source: 'adsblol',
  ...o,
});

describe('mergeAircraft', () => {
  it('keeps the freshest position per hex', () => {
    const a = base({ lat: 28.0, posTs: 1000, source: 'adsblol' });
    const b = base({ lat: 28.1, posTs: 2000, source: 'airplaneslive' });
    const out = mergeAircraft([a], [b]);
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBe(28.1);
    expect(out[0].source).toBe('airplaneslive');
  });

  it('fills fields the fresher report lacks', () => {
    const older = base({ posTs: 1000, reg: 'VT-ABC', type: 'A20N', callsign: 'IGO1' });
    const newer = base({ posTs: 3000, lat: 28.2 });
    const [m] = mergeAircraft([newer], [older]);
    expect(m.lat).toBe(28.2);
    expect(m.reg).toBe('VT-ABC');
    expect(m.type).toBe('A20N');
    expect(m.callsign).toBe('IGO1');
  });

  it('does not mutate inputs and keeps distinct aircraft', () => {
    const x = base({ hex: 'x1' });
    const y = base({ hex: 'y1', posTs: 5 });
    const out = mergeAircraft([x], [y, base({ hex: 'x1', posTs: 0, reg: 'R' })]);
    expect(out.map((a) => a.hex).sort()).toEqual(['x1', 'y1']);
    expect(x.reg).toBeUndefined();
  });

  it('drops stale aircraft', () => {
    expect(dropStale([base({ posTs: 0 }), base({ hex: 'n', posTs: 9000 })], 10_000, 5000).map((a) => a.hex)).toEqual(['n']);
  });
});

describe('parseReadsbResponse', () => {
  it('parses recorded adsb.lol data', () => {
    const list = parseReadsbResponse(DEL as never, 'adsblol');
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) {
      expect(a.hex).toMatch(/^~?[0-9a-f]{6}$/);
      expect(a.posTs).toBeLessThanOrEqual((DEL as { now: number }).now);
      expect(a.source).toBe('adsblol');
    }
  });

  it('handles ground, trims callsigns and computes fix time', () => {
    const [a] = parseReadsbResponse(
      { now: 100_000, ac: [{ hex: 'ABC123', flight: 'IGO2132 ', alt_baro: 'ground', lat: 1, lon: 2, seen_pos: 2.5, gs: 12, baro_rate: 64 }] },
      'adsblol',
    );
    expect(a.hex).toBe('abc123');
    expect(a.callsign).toBe('IGO2132');
    expect(a.onGround).toBe(true);
    expect(a.altBaro).toBeUndefined();
    expect(a.vrate).toBe(0);
    expect(a.posTs).toBe(97_500);
  });

  it('skips aircraft without position', () => {
    expect(parseReadsbResponse({ now: 1, ac: [{ hex: 'aaaaaa' }] }, 'adsblol')).toEqual([]);
  });
});
