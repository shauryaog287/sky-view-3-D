import { describe, expect, it } from 'vitest';
import { buildWeather, metarVisibilityM, nearestMetar, parseMetar, type AwcMetar } from '../src/weather';

const vidp: AwcMetar = {
  icaoId: 'VIDP',
  obsTime: 1794027600,
  rawOb: 'METAR VIDP 070500Z 27005KT 1100 R28/1500 HZ NSC 25/16 Q1017 NOSIG',
  visib: 0.68,
  altim: 1017,
  wxString: 'HZ',
  fltCat: 'LIFR',
  lat: 28.567,
  lon: 77.117,
  clouds: [],
};

describe('weather', () => {
  it('converts METAR visibility from statute miles', () => {
    expect(metarVisibilityM(0.68)).toBe(1094);
    expect(metarVisibilityM('10+')).toBe(16093);
    expect(metarVisibilityM('1/2')).toBe(805);
    expect(metarVisibilityM(undefined)).toBeUndefined();
  });

  it('parses cloud layers (VV counts as overcast)', () => {
    const m = parseMetar({ ...vidp, clouds: [{ cover: 'SCT', base: 2500 }, { cover: 'VV', base: 300 }, { cover: 'CLR', base: null }] });
    expect(m.clouds).toEqual([
      { cover: 'SCT', baseFt: 2500 },
      { cover: 'OVC', baseFt: 300 },
    ]);
    expect(m.altimeterHpa).toBe(1017);
  });

  it('prefers a nearby METAR visibility over the model', () => {
    const w = buildWeather(28.55, 77.1, { visibility: 7940, cloud_cover: 0, is_day: 1 }, vidp, 1794027600_000 + 600_000);
    expect(w.visibilityM).toBe(1094);
    expect(w.isDay).toBe(true);
    expect(w.sources).toHaveLength(2);
  });

  it('picks the nearest recent METAR', () => {
    const far = { ...vidp, icaoId: 'VIDD', lat: 28.58, lon: 77.2 };
    const old = { ...vidp, icaoId: 'OLD1', lat: 28.55, lon: 77.1, obsTime: 1794027600 - 5 * 3600 };
    expect(nearestMetar([far, old, vidp], 28.55, 77.1, 1794027600_000)?.icaoId).toBe('VIDP');
  });
});
