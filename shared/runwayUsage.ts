/**
 * Which runway an aircraft will use. ATC runway assignments are not in public ADS-B data, so they are inferred the way
 * a spotter would:
 *  1. lined up: the runway the aircraft is aligned with on final / rolling on (certain);
 *  2. traffic: the runway ends the airport's recent arrivals (or departures) actually used — "runway in use", learned
 *     live from other aircraft, with a 15-minute half-life so runway changes are picked up;
 *  3. wind: the runway end with the strongest headwind component (≥ 5 kt);
 *  4. geometry: the straight-in end facing the aircraft (arrivals only).
 * For parallel runways the aircraft's lateral position picks between the candidates in the active direction.
 */
import type { Airport, Runway, RunwayEnd } from './airports';
import { angleDiff, bearingDeg, haversineM, trackOffsets } from './geo';

export type RunwayUse = 'arr' | 'dep';
export type AssignmentSource = 'aligned' | 'traffic' | 'wind' | 'geometry';

export interface RunwayAssignment {
  airport: Airport;
  runway: Runway;
  /** Landing threshold (arrivals) or the end the takeoff starts from (departures). */
  end: RunwayEnd;
  far: RunwayEnd;
  kind: RunwayUse;
  source: AssignmentSource;
}

interface UsageEvent {
  end: string;
  hdg: number;
  kind: RunwayUse;
  t: number;
}

const ends = (r: Runway): [RunwayEnd, RunwayEnd][] => [
  [r.le, r.he],
  [r.he, r.le],
];

export class RunwayUsage {
  /** Events older than this are forgotten. */
  windowMs = 60 * 60_000;
  halfLifeMs = 15 * 60_000;
  /** icao → (aircraft hex + kind → latest event); one vote per aircraft and movement. */
  private readonly byAirport = new Map<string, Map<string, UsageEvent>>();

  record(airport: Airport, hex: string, end: RunwayEnd, kind: RunwayUse, t: number) {
    let m = this.byAirport.get(airport.ident);
    if (!m) this.byAirport.set(airport.ident, (m = new Map()));
    m.set(`${hex}:${kind}`, { end: end.ident, hdg: end.hdg, kind, t });
  }

  /** Decayed vote per runway end ident for one kind of movement (or both when kind is omitted). */
  votes(icao: string, now: number, kind?: RunwayUse): Map<string, { w: number; hdg: number }> {
    const out = new Map<string, { w: number; hdg: number }>();
    const m = this.byAirport.get(icao);
    if (!m) return out;
    for (const [key, e] of m) {
      const age = now - e.t;
      if (age > this.windowMs) {
        m.delete(key);
        continue;
      }
      if (kind && e.kind !== kind) continue;
      const w = 0.5 ** (Math.max(0, age) / this.halfLifeMs);
      const cur = out.get(e.end);
      out.set(e.end, { w: (cur?.w ?? 0) + w, hdg: e.hdg });
    }
    return out;
  }

  assign(airport: Airport, kind: RunwayUse, now: number, opts: { wind?: { dir: number; kt: number }; from?: { lat: number; lon: number } } = {}): RunwayAssignment | undefined {
    const all = airport.runways.flatMap(ends);
    if (!all.length) return undefined;
    const pick = (cands: [RunwayEnd, RunwayEnd][], source: AssignmentSource): RunwayAssignment => {
      const [end, far] = choose(airport, cands, kind, opts.from);
      return { airport, runway: airport.runways.find((r) => r.le === end || r.he === end)!, end, far, kind, source };
    };
    // 1. The exact end this kind of movement has been using.
    const same = best(this.votes(airport.ident, now, kind));
    if (same && same.w >= 0.25) {
      const exact = all.filter(([e]) => e.ident === same.ident);
      if (exact.length) return pick(exact.length > 1 ? exact : withParallels(all, exact[0][0].hdg, kind, opts.from, exact), 'traffic');
    }
    // 2. Flow direction from any movement (arrivals and departures share it).
    const any = best(this.votes(airport.ident, now));
    if (any && any.w >= 0.25) return pick(inDirection(all, any.hdg), 'traffic');
    // 3. Wind.
    if (opts.wind && opts.wind.kt >= 5) {
      const head = (e: RunwayEnd) => Math.cos(((opts.wind!.dir - e.hdg) * Math.PI) / 180);
      const top = all.reduce((a, b) => (head(b[0]) > head(a[0]) ? b : a));
      return pick(inDirection(all, top[0].hdg), 'wind');
    }
    // 4. Straight-in from where the aircraft is.
    if (kind === 'arr' && opts.from) {
      const brgToAc = bearingDeg(airport.lat, airport.lon, opts.from.lat, opts.from.lon);
      // Landing on an end with heading h means approaching from bearing h + 180 relative to the airport.
      const top = all.reduce((a, b) => (Math.abs(angleDiff(brgToAc, b[0].hdg + 180)) < Math.abs(angleDiff(brgToAc, a[0].hdg + 180)) ? b : a));
      return pick(inDirection(all, top[0].hdg), 'geometry');
    }
    return undefined;
  }

  clear() {
    this.byAirport.clear();
  }
}

function best(v: Map<string, { w: number; hdg: number }>): { ident: string; w: number; hdg: number } | undefined {
  let out: { ident: string; w: number; hdg: number } | undefined;
  for (const [ident, x] of v) if (!out || x.w > out.w) out = { ident, ...x };
  return out;
}

function inDirection(all: [RunwayEnd, RunwayEnd][], hdg: number): [RunwayEnd, RunwayEnd][] {
  const c = all.filter(([e]) => Math.abs(angleDiff(e.hdg, hdg)) < 35);
  return c.length ? c : all;
}

/** An exact learned end, plus its parallels when we know where the aircraft is (it may be cleared for the other one). */
function withParallels(all: [RunwayEnd, RunwayEnd][], hdg: number, kind: RunwayUse, from: { lat: number; lon: number } | undefined, exact: [RunwayEnd, RunwayEnd][]) {
  if (kind !== 'arr' || !from) return exact;
  return all.filter(([e]) => Math.abs(angleDiff(e.hdg, hdg)) < 10);
}

/**
 * Among candidate ends in the active direction: arrivals take the centreline closest to the aircraft once it is near
 * (parallel runways), departures the end nearest to the aircraft on the ground, otherwise the longest runway.
 */
function choose(airport: Airport, cands: [RunwayEnd, RunwayEnd][], kind: RunwayUse, from?: { lat: number; lon: number }): [RunwayEnd, RunwayEnd] {
  const len = (e: RunwayEnd) => airport.runways.find((r) => r.le === e || r.he === e)?.lengthFt ?? 0;
  if (cands.length === 1 || !from) return cands.reduce((a, b) => (len(b[0]) > len(a[0]) ? b : a));
  if (kind === 'arr') {
    const score = ([e, f]: [RunwayEnd, RunwayEnd]) => {
      const { along, cross } = trackOffsets(e.lat, e.lon, bearingDeg(e.lat, e.lon, f.lat, f.lon), from.lat, from.lon);
      // Only meaningful on the approach side and within ~30 km; otherwise prefer the longer runway.
      return along < 0 && along > -30_000 ? Math.abs(cross) : 1e6 - len(e);
    };
    return cands.reduce((a, b) => (score(b) < score(a) ? b : a));
  }
  return cands.reduce((a, b) => (haversineM(from.lat, from.lon, b[0].lat, b[0].lon) < haversineM(from.lat, from.lon, a[0].lat, a[0].lon) ? b : a));
}
