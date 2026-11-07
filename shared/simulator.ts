import { parseReadsbResponse, type ReadsbResponse } from './readsb';
import type { AircraftState } from './types';
import type { AirportIndex, RunwayEnd } from './airports';
import { bearingDeg, clamp, destinationPoint, FT_TO_M, haversineM, KT_TO_MS, NM_TO_M, norm360, M_TO_FT } from './geo';

/**
 * Deterministic flight simulator used by mock mode (browser) and the FixtureProvider (Worker).
 *
 * - Recorded aircraft from real ADS-B fixtures fly on from their recorded state (great-circle dead reckoning,
 *   levelling off at sensible altitudes) and loop back every `loopMs`.
 * - Scripted arrivals/departures fly real runway geometry so takeoff/landing cameras can be tested any time.
 */
export interface ScriptedFlight {
  hex: string;
  callsign: string;
  reg: string;
  type: string;
  kind: 'arrival' | 'departure';
  airportIcao: string;
  /** Threshold landed on / departed from, and the opposite end. */
  end: RunwayEnd;
  far: RunwayEnd;
  periodS: number;
  offsetS: number;
}

export interface SimulatorOptions {
  loopMs?: number;
  /** Epoch ms at which the recorded snapshots are "replayed from". Defaults to construction time. */
  epoch?: number;
  noiseM?: number;
}

interface SeedAircraft {
  s: AircraftState;
  /** Altitude at which a climbing/descending aircraft levels off. */
  levelAt?: number;
}

const GS_ARR_KT = 145;
const GS_DEP_KT = 165;

export class FlightSimulator {
  private readonly seeds: SeedAircraft[] = [];
  private readonly loopMs: number;
  private readonly epoch: number;
  private readonly noiseM: number;

  constructor(
    snapshots: ReadsbResponse[],
    readonly scripted: ScriptedFlight[] = [],
    opts: SimulatorOptions = {},
  ) {
    this.loopMs = opts.loopMs ?? 30 * 60_000;
    this.epoch = opts.epoch ?? Date.now();
    this.noiseM = opts.noiseM ?? 0;
    const seen = new Set<string>();
    for (const snap of snapshots) {
      for (const s of parseReadsbResponse(snap, 'fixture')) {
        if (seen.has(s.hex)) continue;
        seen.add(s.hex);
        // Re-base every snapshot so it starts "now".
        const age = (snap.now ?? s.posTs) - s.posTs;
        const based = { ...s, posTs: -age, seenTs: 0 };
        let levelAt: number | undefined;
        const alt = s.altBaro ?? s.altGeom;
        if (alt !== undefined && s.vrate !== undefined) {
          if (s.vrate > 400) levelAt = Math.max(alt, alt > 20_000 ? 37_000 : 24_000);
          else if (s.vrate < -400) levelAt = Math.min(alt, alt > 12_000 ? 10_000 : 2_500);
        }
        this.seeds.push({ s: based, levelAt });
      }
    }
  }

  get size() {
    return this.seeds.length + this.scripted.length;
  }

  /** Every simulated aircraft at wall-clock time `t` (epoch ms). */
  snapshot(t: number): AircraftState[] {
    const out: AircraftState[] = [];
    const dt = (((t - this.epoch) % this.loopMs) + this.loopMs) % this.loopMs;
    for (const seed of this.seeds) out.push(this.advance(seed, dt / 1000, t));
    for (const f of this.scripted) {
      const s = scriptedState(f, t);
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * Continuous history for one aircraft (no loop wrap), e.g. to fake a 60-minute replay in mock mode.
   * Recorded aircraft are flown backwards/forwards from their recorded state; scripted flights use their script.
   */
  history(hex: string, fromMs: number, toMs: number, stepMs: number): AircraftState[] {
    const out: AircraftState[] = [];
    const seed = this.seeds.find((s) => s.s.hex === hex);
    const script = this.scripted.find((f) => f.hex === hex);
    const loopStart = toMs - ((((toMs - this.epoch) % this.loopMs) + this.loopMs) % this.loopMs);
    for (let t = fromMs; t <= toMs; t += stepMs) {
      if (seed) {
        const dt = (t - loopStart) / 1000;
        out.push(this.advance(seed, dt, t));
      } else if (script) {
        const cycleStart = toMs - (((toMs / 1000 + script.offsetS) % script.periodS) * 1000);
        if (t < cycleStart) continue;
        const s = scriptedState(script, t);
        if (s) out.push(s);
      }
    }
    return out;
  }

  private advance(seed: SeedAircraft, dtS: number, t: number): AircraftState {
    const s = seed.s;
    const ageS = -s.posTs / 1000; // fix age at record time
    const flyS = dtS + ageS;
    if (s.onGround || (s.gs ?? 0) < 40 || s.track === undefined) {
      return { ...s, posTs: t - 1000, seenTs: t - 500 };
    }
    const distM = (s.gs ?? 0) * KT_TO_MS * flyS;
    // Gentle continuation of any recorded turn for up to 60 s, then straight.
    const turnS = Math.min(flyS, 60);
    const trackRate = clamp(s.trackRate ?? 0, -3, 3);
    const midTrack = norm360(s.track + (trackRate * turnS) / 2);
    const finalTrack = norm360(s.track + trackRate * turnS);
    const p = destinationPoint(s.lat, s.lon, midTrack, distM);
    const out: AircraftState = { ...s, lat: p.lat, lon: p.lon, track: finalTrack, posTs: t - 800, seenTs: t - 300 };
    if (flyS > 60) out.trackRate = 0;
    if (s.roll !== undefined && flyS > 60) out.roll = 0;
    const alt0 = s.altBaro ?? s.altGeom;
    if (alt0 !== undefined && s.vrate !== undefined && seed.levelAt !== undefined) {
      const raw = alt0 + (s.vrate * flyS) / 60;
      const levelled = s.vrate > 0 ? Math.min(raw, seed.levelAt) : Math.max(raw, seed.levelAt);
      const delta = clamp(levelled, 0, 41_000) - alt0;
      if (s.altBaro !== undefined) out.altBaro = Math.round(s.altBaro + delta);
      if (s.altGeom !== undefined) out.altGeom = Math.round(s.altGeom + delta);
      if (levelled !== raw) out.vrate = 0;
    }
    if (this.noiseM > 0) {
      const n = destinationPoint(out.lat, out.lon, (t / 7) % 360, ((t / 1000) % 1) * this.noiseM);
      out.lat = n.lat;
      out.lon = n.lon;
    }
    return out;
  }
}

/** Position of a scripted flight at time t, or undefined while it is "off stage" in its loop. */
export function scriptedState(f: ScriptedFlight, t: number): AircraftState | undefined {
  const local = ((((t / 1000 + f.offsetS) % f.periodS) + f.periodS) % f.periodS);
  const rwyBrg = bearingDeg(f.end.lat, f.end.lon, f.far.lat, f.far.lon);
  const elev = f.end.elevFt;
  const base = {
    hex: f.hex,
    callsign: f.callsign,
    reg: f.reg,
    type: f.type,
    category: 'A3',
    posTs: t - 600,
    seenTs: t - 300,
    source: 'fixture' as const,
  };
  const at = (alongM: number) => destinationPoint(f.end.lat, f.end.lon, rwyBrg, alongM);

  if (f.kind === 'arrival') {
    // 0–420 s: 3° final from ~17 NM; touchdown ~300 m past threshold; rollout to 20 kt; vacate.
    const startM = -17 * NM_TO_M;
    const finalS = Math.round((300 - startM) / (160 * KT_TO_MS)); // average 160 kt over the final
    if (local < finalS) {
      const frac = local / finalS;
      // Decelerate 180 → 140 kt along the approach.
      const gs = 180 - 40 * frac;
      const along = startM + (300 - startM) * easeDecel(frac);
      const agl = Math.max(0, (300 - along) * Math.tan((3 * Math.PI) / 180) * M_TO_FT + 50 * (1 - frac));
      const p = at(along);
      return {
        ...base,
        lat: p.lat,
        lon: p.lon,
        altBaro: Math.round(elev + agl),
        onGround: false,
        gs: Math.round(gs),
        track: rwyBrg,
        vrate: Math.round(-gs * KT_TO_MS * Math.tan((3 * Math.PI) / 180) * M_TO_FT * 60),
      };
    }
    const rollS = local - finalS;
    const rollDur = 45;
    if (rollS < rollDur + 25) {
      const k = Math.min(1, rollS / rollDur);
      const gs = rollS < rollDur ? 140 - 120 * k : 20;
      // Distance = integral of a linearly decaying speed.
      const v0 = 140 * KT_TO_MS;
      const v1 = 20 * KT_TO_MS;
      const s =
        rollS < rollDur
          ? v0 * rollS - (0.5 * (v0 - v1) * rollS * rollS) / rollDur
          : 0.5 * (v0 + v1) * rollDur + v1 * (rollS - rollDur);
      const p = at(300 + s);
      return { ...base, lat: p.lat, lon: p.lon, altBaro: undefined, onGround: true, gs: Math.round(gs), track: rwyBrg, vrate: 0 };
    }
    return undefined;
  }

  // Departure: 0–20 s lined up, 20–58 s takeoff roll, then climb-out straight ahead for ~4 min.
  const lined = 20;
  const rollDur = 38;
  const a = (GS_DEP_KT * KT_TO_MS) / rollDur;
  if (local < lined) {
    const p = at(60);
    return { ...base, lat: p.lat, lon: p.lon, onGround: true, gs: 0, track: rwyBrg, vrate: 0 };
  }
  if (local < lined + rollDur) {
    const tr = local - lined;
    const p = at(60 + 0.5 * a * tr * tr);
    return { ...base, lat: p.lat, lon: p.lon, onGround: true, gs: Math.round((a * tr) / KT_TO_MS), track: rwyBrg, vrate: 0 };
  }
  const climbS = local - lined - rollDur;
  if (climbS > 260) return undefined;
  const liftoffAlong = 60 + 0.5 * a * rollDur * rollDur;
  const gs = Math.min(250, GS_DEP_KT + climbS * 0.5);
  const dist = liftoffAlong + (GS_DEP_KT * KT_TO_MS + 0.25 * KT_TO_MS * climbS) * climbS;
  const p = at(dist);
  const vr = Math.min(2800, 1200 + climbS * 60);
  const agl = Math.min(12_000, (1200 * climbS + 30 * climbS * climbS) / 60);
  return { ...base, lat: p.lat, lon: p.lon, onGround: false, altBaro: Math.round(elev + agl), gs: Math.round(gs), track: rwyBrg, vrate: vr };
}

function easeDecel(x: number) {
  // Distance covered under a linearly decreasing speed (180→140 kt) normalised to [0,1].
  const v0 = 180;
  const v1 = 140;
  return (v0 * x - 0.5 * (v0 - v1) * x * x) / (v0 - 0.5 * (v0 - v1));
}

/** Demo scripted flights at real runways. Fictional SkyView ("SKV") callsigns so nothing impersonates an airline. */
export function defaultScriptedFlights(airports: AirportIndex): ScriptedFlight[] {
  const defs: { icao: string; rwy: string; kind: ScriptedFlight['kind']; cs: string; type: string; reg: string; offset: number }[] = [
    { icao: 'VIDP', rwy: '28', kind: 'arrival', cs: 'SKV101', type: 'A20N', reg: 'VT-SKA', offset: 330 },
    { icao: 'VABB', rwy: '27', kind: 'departure', cs: 'SKV202', type: 'B77W', reg: 'VT-SKB', offset: 0 },
    { icao: 'VOBL', rwy: '09L', kind: 'arrival', cs: 'SKV303', type: 'AT76', reg: 'VT-SKC', offset: 120 },
    { icao: 'VERP', rwy: '24', kind: 'departure', cs: 'SKV404', type: 'B38M', reg: 'VT-SKD', offset: 150 },
    { icao: 'VOHS', rwy: '27R', kind: 'arrival', cs: 'SKV505', type: 'A321', reg: 'VT-SKE', offset: 40 },
  ];
  const out: ScriptedFlight[] = [];
  defs.forEach((d, i) => {
    const ap = airports.get(d.icao);
    const rw = ap?.runways.find((r) => r.le.ident === d.rwy || r.he.ident === d.rwy);
    if (!ap || !rw) return;
    const [end, far] = rw.le.ident === d.rwy ? [rw.le, rw.he] : [rw.he, rw.le];
    out.push({
      hex: `~5c${(i + 1).toString(16).padStart(4, '0')}`,
      callsign: d.cs,
      reg: d.reg,
      type: d.type,
      kind: d.kind,
      airportIcao: ap.ident,
      end,
      far,
      // Loop length ≈ active duration so demo flights are (almost) always on screen.
      periodS: d.kind === 'arrival' ? 460 : 322,
      offsetS: d.offset,
    });
  });
  return out;
}

/** Simple spatial filter for simulator snapshots. */
export function nearPoint(list: AircraftState[], lat: number, lon: number, radiusNm: number): AircraftState[] {
  const r = radiusNm * NM_TO_M;
  return list.filter((a) => haversineM(lat, lon, a.lat, a.lon) <= r);
}

export const SIM_FT_TO_M = FT_TO_M;
