import { describe, expect, it } from 'vitest';
import { AirportIndex, type CompactAirportFile } from './airports';
import { destinationPoint } from './geo';
import { RunwayUsage } from './runwayUsage';
import airportsJson from '../data/airports.json';

const index = AirportIndex.fromCompact(airportsJson as unknown as CompactAirportFile);
const DEL = index.get('VIDP')!;
const end = (ident: string) => DEL.runways.flatMap((r) => [r.le, r.he]).find((e) => e.ident === ident)!;
const T = 1_800_000_000_000;
const west = destinationPoint(DEL.lat, DEL.lon, 270, 60_000);
const east = destinationPoint(DEL.lat, DEL.lon, 90, 60_000);

describe('runway in use', () => {
  it('without information, arrivals get the straight-in end facing them', () => {
    const u = new RunwayUsage();
    const a = u.assign(DEL, 'arr', T, { from: west })!;
    expect(a.source).toBe('geometry');
    expect(Math.abs(a.end.hdg - 100)).toBeLessThan(30); // eastbound: 09 / 10 / 11L / 11R
    expect(u.assign(DEL, 'arr', T, { from: east })!.end.hdg).toBeGreaterThan(250);
    expect(u.assign(DEL, 'dep', T)).toBeUndefined();
  });

  it('learns the runway arrivals are actually using', () => {
    const u = new RunwayUsage();
    for (const [i, hex] of ['a1', 'a2', 'a3'].entries()) u.record(DEL, hex, end('29L'), 'arr', T - i * 120_000);
    const a = u.assign(DEL, 'arr', T, { from: west })!; // even an aircraft coming from the west is sequenced onto 29L
    expect(a.source).toBe('traffic');
    expect(a.end.ident).toBe('29L');
  });

  it('uses departures to infer the flow direction for arrivals, and vice versa', () => {
    const u = new RunwayUsage();
    u.record(DEL, 'd1', end('29R'), 'dep', T - 60_000);
    const a = u.assign(DEL, 'arr', T, { from: west })!;
    expect(a.source).toBe('traffic');
    expect(a.end.hdg).toBeGreaterThan(250);
    const d = new RunwayUsage();
    d.record(DEL, 'x1', end('10'), 'arr', T - 60_000);
    expect(d.assign(DEL, 'dep', T)!.end.hdg).toBeLessThan(130);
  });

  it('the exact learned departure runway wins', () => {
    const u = new RunwayUsage();
    u.record(DEL, 'd1', end('28'), 'dep', T - 30_000);
    u.record(DEL, 'd2', end('28'), 'dep', T - 90_000);
    expect(u.assign(DEL, 'dep', T)!.end.ident).toBe('28');
  });

  it('falls back to the headwind runway, and forgets old traffic', () => {
    const u = new RunwayUsage();
    u.record(DEL, 'old', end('11R'), 'arr', T - 3 * 3_600_000);
    const a = u.assign(DEL, 'arr', T, { from: east, wind: { dir: 280, kt: 12 } })!;
    expect(a.source).toBe('wind');
    expect(a.end.hdg).toBeGreaterThan(250);
  });

  it('picks the parallel runway the aircraft is actually lined up with', () => {
    const u = new RunwayUsage();
    u.record(DEL, 'a1', end('29L'), 'arr', T - 60_000);
    const thr = end('29R');
    // 10 km out on the extended centreline of 29R (approach from the east: opposite of the landing heading).
    const onFinal = destinationPoint(thr.lat, thr.lon, thr.hdg + 180, 10_000);
    expect(u.assign(DEL, 'arr', T, { from: onFinal })!.end.ident).toBe('29R');
  });
});
