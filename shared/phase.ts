import type { AirportIndex, RunwayMatch } from './airports';
import type { FlightPhase } from './types';
import { FT_TO_M, NM_TO_M } from './geo';

/**
 * Flight phase detection from ADS-B state + runway geometry.
 *
 *   ground · takeoff_roll · climb · cruise · descent · approach · landing
 *
 * Inputs: altitude (pressure altitude, ft) relative to the nearest runway's elevation (≈ AGL), vertical rate, ground
 * speed and its trend, and lateral/along-track alignment with the best-matching runway. A short debounce (hysteresis)
 * prevents flicker from noisy vertical rates.
 */
export interface PhaseInput {
  t: number;
  lat: number;
  lon: number;
  onGround: boolean;
  /** Pressure altitude (preferred) or geometric altitude, ft. Undefined when unknown. */
  altFt?: number;
  gsKt?: number;
  vrateFpm?: number;
  track?: number;
}

export interface PhaseMemory {
  phase: FlightPhase;
  since: number;
  candidate?: FlightPhase;
  candidateSince?: number;
  lastGs?: number;
  lastT?: number;
  /** Smoothed ground acceleration, kt/s. */
  accel?: number;
}

export interface PhaseResult {
  phase: FlightPhase;
  runway?: RunwayMatch;
  /** Height above the runway/field elevation, ft (undefined when no airport nearby or altitude unknown). */
  aglFt?: number;
  memory: PhaseMemory;
}

const HOLD_MS = 2500;

/** Phases we switch into immediately (they are short-lived and strongly signalled). */
const FAST: FlightPhase[] = ['takeoff_roll', 'landing'];

export function detectPhase(input: PhaseInput, airports: AirportIndex | undefined, prev?: PhaseMemory): PhaseResult {
  const gs = input.gsKt ?? 0;
  const vr = input.vrateFpm ?? 0;
  // Ground acceleration trend (helps tell a takeoff roll from a landing rollout).
  let accel = prev?.accel ?? 0;
  if (prev?.lastGs !== undefined && prev.lastT !== undefined && input.gsKt !== undefined) {
    const dt = (input.t - prev.lastT) / 1000;
    if (dt > 0.2 && dt < 30) accel = accel * 0.5 + ((input.gsKt - prev.lastGs) / dt) * 0.5;
  }

  const rwy = airports?.bestRunway(input.lat, input.lon, input.track, 30_000);
  const fieldElev = rwy ? (rwy.end.elevFt + rwy.far.elevFt) / 2 : undefined;
  const agl = input.altFt !== undefined && fieldElev !== undefined ? input.altFt - fieldElev : undefined;
  const raw = classify(input, rwy, agl, accel, prev?.phase);

  // Debounce: a new phase must persist HOLD_MS before it replaces the current one (except fast ones).
  let phase = prev?.phase ?? raw;
  let candidate = prev?.candidate;
  let candidateSince = prev?.candidateSince;
  let since = prev?.since ?? input.t;
  if (!prev || prev.phase === 'unknown') {
    phase = raw;
    since = input.t;
    candidate = undefined;
  } else if (raw === prev.phase) {
    candidate = undefined;
  } else if (FAST.includes(raw)) {
    phase = raw;
    since = input.t;
    candidate = undefined;
  } else if (candidate === raw && candidateSince !== undefined && input.t - candidateSince >= HOLD_MS) {
    phase = raw;
    since = input.t;
    candidate = undefined;
  } else if (candidate !== raw) {
    candidate = raw;
    candidateSince = input.t;
  }

  return {
    phase,
    runway: rwy,
    aglFt: agl,
    memory: { phase, since, candidate, candidateSince, lastGs: input.gsKt ?? prev?.lastGs, lastT: input.t, accel },
  };
}

function classify(input: PhaseInput, rwy: RunwayMatch | undefined, agl: number | undefined, accel: number, prev?: FlightPhase): FlightPhase {
  const gs = input.gsKt ?? 0;
  const vr = input.vrateFpm ?? 0;
  const onGround = input.onGround || (agl !== undefined && agl < 50 && gs < 60 && Math.abs(vr) < 300);

  if (onGround) {
    const onRunway = !!rwy && (rwy.onRunway || (rwy.headingDiff < 15 && Math.abs(rwy.crossM) < 60)) && rwy.headingDiff < 30;
    if (gs >= 35 && onRunway) {
      if (prev === 'approach' || prev === 'landing') return 'landing';
      if (prev === 'ground' || prev === 'takeoff_roll') return accel < -1.5 ? 'landing' : 'takeoff_roll';
      if (accel > 0.5) return 'takeoff_roll';
      if (accel < -0.5) return 'landing';
      return gs >= 80 ? 'takeoff_roll' : 'ground';
    }
    if (prev === 'landing' && gs >= 25) return 'landing';
    return 'ground';
  }

  if (input.altFt === undefined) return prev ?? 'unknown';

  // Aligned with a runway: within a cone around the extended centreline, heading within 25°.
  const aligned =
    !!rwy &&
    rwy.headingDiff < 25 &&
    rwy.alongM > -15 * NM_TO_M &&
    rwy.alongM < rwy.runway.lengthFt * FT_TO_M &&
    Math.abs(rwy.crossM) < Math.max(250, Math.abs(Math.min(0, rwy.alongM)) * 0.12);
  const a = agl ?? input.altFt;

  if (aligned && a < 200 && vr <= 100 && rwy!.alongM > -3000) return 'landing';
  // Established on final (ILS intercepts happen up to ~6,000 ft AGL, 18 NM out).
  if (aligned && a < 6000 && vr < -150 && rwy!.alongM < 0) return 'approach';
  // Circling / visual approaches: low, descending and close to an airport without straight-in alignment.
  if (rwy && a < 1800 && vr < -200 && rwy.distToEndM < 9 * NM_TO_M) return 'approach';
  if (vr > 400) return 'climb';
  if (vr < -400) return prev === 'approach' && aligned ? 'approach' : 'descent';
  // Weak vertical rate: keep a climb/descent going rather than flapping to cruise.
  if ((prev === 'climb' && vr > 150) || (prev === 'descent' && vr < -150)) return prev;
  if (prev === 'approach' && aligned) return 'approach';
  return 'cruise';
}

/** Phases in which tower / runway-end cameras make sense. */
export function isAirportPhase(p: FlightPhase | undefined): boolean {
  return p === 'approach' || p === 'landing' || p === 'takeoff_roll' || p === 'ground';
}
