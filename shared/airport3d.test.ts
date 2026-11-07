import { describe, expect, it } from 'vitest';
import { convertOsm, simplify, toLatLon, type OsmElement } from './airport3d';
import { offsetLatLon } from './geo';

const O: [number, number] = [28.5665, 77.1031];
const sq = (e: number, n: number, s: number) => {
  const pts = [
    [e, n],
    [e + s, n],
    [e + s, n + s],
    [e, n + s],
    [e, n],
  ];
  return pts.map(([x, y]) => offsetLatLon(O[0], O[1], x, y));
};

describe('OSM → 3D airport', () => {
  const elements: OsmElement[] = [
    { type: 'way', id: 1, tags: { aeroway: 'terminal', 'building:levels': '4' }, geometry: sq(0, 0, 200) },
    { type: 'way', id: 2, tags: { building: 'hangar' }, geometry: sq(400, 0, 100) },
    { type: 'way', id: 3, tags: { aeroway: 'tower', height: '102' }, geometry: sq(-300, 50, 20) },
    { type: 'way', id: 4, tags: { aeroway: 'jet_bridge' }, geometry: [offsetLatLon(O[0], O[1], 0, -5), offsetLatLon(O[0], O[1], 0, -40)] },
    { type: 'way', id: 5, tags: { aeroway: 'taxiway', width: '30' }, geometry: [offsetLatLon(O[0], O[1], -500, -200), offsetLatLon(O[0], O[1], 500, -200)] },
    { type: 'way', id: 6, tags: { building: 'roof' }, geometry: sq(0, 300, 50) },
    { type: 'way', id: 7, tags: { building: 'yes' }, geometry: sq(900, 900, 3) }, // 9 m²: skipped
    { type: 'way', id: 8, tags: { aeroway: 'apron' }, geometry: sq(0, -300, 300) },
  ];
  const a = convertOsm('VIDP', O, elements, '2026-11-07');

  it('extrudes buildings with tagged / level-based / default heights', () => {
    const term = a.buildings.find((b) => b.k === 'terminal')!;
    expect(term.h).toBe(24); // 4 levels × 5.5 + 2
    expect(a.buildings.find((b) => b.k === 'hangar')!.h).toBe(24); // big hangar default
    expect(a.buildings.find((b) => b.k === 'roof')).toMatchObject({ h: 9, min: 7.5 });
    expect(a.buildings).toHaveLength(4);
    // Local metres, closing point removed.
    expect(term.ring.length).toBe(8);
    expect(term.ring[0]).toBeCloseTo(0, 0);
    expect(term.ring[2]).toBeCloseTo(200, 0);
  });

  it('finds the control tower (for the tower camera)', () => {
    expect(a.towers[0]).toMatchObject({ x: -290, y: 60, h: 98 });
    // Without a height tag the curated tower height is used (OSM levels usually count only the cab).
    const b = convertOsm('VIDP', O, [{ type: 'way', id: 9, tags: { aeroway: 'tower', 'building:levels': '5' }, geometry: sq(0, 0, 20) }], 'x', { towerHeightM: 100 });
    expect(b.buildings[0].h).toBe(100);
    expect(b.towers[0].h).toBe(96);
  });

  it('keeps jet bridges, taxiways (with width) and aprons', () => {
    expect(a.bridges[0].line).toHaveLength(4);
    expect(a.taxiways[0]).toMatchObject({ w: 30 });
    expect(a.aprons).toHaveLength(1);
    expect(a.attribution).toContain('OpenStreetMap');
  });

  it('round-trips local metres to lat/lon', () => {
    const p = toLatLon(O, 200, 100);
    const q = offsetLatLon(O[0], O[1], 200, 100);
    expect(p.lat).toBeCloseTo(q.lat, 7);
    expect(p.lon).toBeCloseTo(q.lon, 7);
  });

  it('simplifies collinear points', () => {
    expect(simplify([0, 0, 1, 0.01, 2, 0, 3, 0, 3, 3], 0.1)).toEqual([0, 0, 3, 0, 3, 3]);
  });
});
