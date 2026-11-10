import { describe, expect, it } from 'vitest';
import type { Airport3D } from './airport3d';
import { LIGHT, PAPI_ANGLES_DEG, airfieldLighting, apronMasts, papiColour } from './airportLights';
import { destinationPoint } from './geo';
import vidpJson from '../public/airports3d/VIDP.json';

// A 3 km east–west runway at the origin.
const A = destinationPoint(10, 20, 270, 1500);
const B = destinationPoint(10, 20, 90, 1500);
const airport = {
  lat: 10,
  lon: 20,
  kind: 'L' as const,
  runways: [{ le: { ...A, displacedFt: 0 }, he: { ...B, displacedFt: 0 }, lengthFt: 9843, widthFt: 148 }],
};

describe('airfield lighting', () => {
  const { lights, runways } = airfieldLighting(airport, null);

  it('lays out one runway along its real axis', () => {
    expect(runways).toHaveLength(1);
    expect(runways[0].length).toBeCloseTo(3000, -1);
    expect(runways[0].ax).toBeCloseTo(1, 2);
    expect(lights.length).toBeGreaterThan(500);
    expect(lights.length).toBeLessThan(2500);
  });

  it('thresholds are green from the approach and red from the runway', () => {
    const atA = lights.filter((l) => Math.abs(l.x + 1500) < 1 && Math.abs(l.y) < 20 && l.papi < 0 && l.period === 0 && l.z < 0.35);
    expect(atA.length).toBeGreaterThan(6);
    for (const l of atA) expect([l.a, l.b]).toEqual([LIGHT.GREEN, LIGHT.RED]);
    const atB = lights.filter((l) => Math.abs(l.x - 1500) < 1 && Math.abs(l.y) < 20 && l.papi < 0 && l.z < 0.35);
    for (const l of atB) expect([l.a, l.b]).toEqual([LIGHT.RED, LIGHT.GREEN]);
  });

  it('edge lights turn amber over the last 600 m in each direction', () => {
    const edges = lights.filter((l) => Math.abs(Math.abs(l.y) - 24.5) < 1 && l.size === 2 && l.z === 0.4);
    const nearB = edges.find((l) => l.x > 1000)!;
    const nearA = edges.find((l) => l.x < -1000)!;
    expect([nearB.a, nearB.b]).toEqual([LIGHT.AMBER, LIGHT.WHITE]);
    expect([nearA.a, nearA.b]).toEqual([LIGHT.WHITE, LIGHT.AMBER]);
  });

  it('approach lights and flashers only show from their own side', () => {
    const before = lights.filter((l) => l.x < -1530 && l.papi < 0);
    expect(before.length).toBeGreaterThan(100);
    for (const l of before) expect(l.b).toBe(LIGHT.OFF);
    const flashers = before.filter((l) => l.period > 0);
    expect(flashers.length).toBeGreaterThan(15);
    // The rabbit runs towards the threshold: phase grows as the distance shrinks.
    const far = flashers.reduce((p, q) => (q.x < p.x ? q : p));
    const near = flashers.reduce((p, q) => (q.x > p.x ? q : p));
    expect(near.phase).toBeGreaterThan(far.phase);
  });

  it('has a four-unit PAPI left of each runway end, reading by glide angle', () => {
    const papiA = lights.filter((l) => l.papi >= 0 && l.end === 0);
    expect(papiA).toHaveLength(4);
    // Landing eastbound on A: left is north (positive y).
    for (const l of papiA) expect(l.y).toBeGreaterThan(30);
    const show = (angle: number) => [0, 1, 2, 3].map((k) => papiColour(k, angle));
    expect(show(3.0)).toEqual([LIGHT.RED, LIGHT.RED, LIGHT.WHITE, LIGHT.WHITE]);
    expect(show(4)).toEqual([LIGHT.WHITE, LIGHT.WHITE, LIGHT.WHITE, LIGHT.WHITE]);
    expect(show(2)).toEqual([LIGHT.RED, LIGHT.RED, LIGHT.RED, LIGHT.RED]);
    expect(PAPI_ANGLES_DEG).toHaveLength(4);
  });

  it('adds taxiway lights, floodlights and obstruction lights from scenery data (Delhi)', () => {
    const a = vidpJson as unknown as Airport3D;
    const del = {
      lat: a.origin[0],
      lon: a.origin[1],
      kind: 'L' as const,
      runways: [{ le: { lat: 28.5675, lon: 77.0727, displacedFt: 0 }, he: { lat: 28.5594, lon: 77.1131, displacedFt: 0 }, lengthFt: 12500, widthFt: 150 }],
    };
    const r = airfieldLighting(del, a, [{ x: 0, y: 0, z: 100 }]);
    const count = (c: number) => r.lights.filter((l) => l.a === c).length;
    expect(count(LIGHT.GREEN)).toBeGreaterThan(300);
    expect(count(LIGHT.BLUE)).toBeGreaterThan(100);
    expect(count(LIGHT.FLOOD)).toBeGreaterThan(20);
    expect(r.lights.some((l) => l.z === 100 && l.a === LIGHT.RED)).toBe(true);
    expect(r.lights.length).toBeLessThan(16000);
    expect(apronMasts(a).length).toBeLessThanOrEqual(60);
  });
});
