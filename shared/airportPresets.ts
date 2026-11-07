import type { Airport, Runway, RunwayEnd } from './airports';
import { bearingDeg, destinationPoint, FT_TO_M, haversineM, norm360 } from './geo';

/**
 * Ground camera presets for takeoff / landing views.
 *
 * Positions are defined relative to runway geometry (not raw coordinates) so they stay valid when runway data is
 * refreshed and so every airport gets something sensible:
 *   - tower:  beside the runway in use, at `towerAlong` of its length, `towerSide` metres to one side, `towerHeight` m up.
 *   - runway: for arrivals, under the approach path before the threshold ("spotter at the fence");
 *             for departures, beside the runway near the typical rotation point.
 *
 * Curated airports have hand-tuned sides/heights (e.g. tower side = terminal side, between parallel runways).
 * Verify on device with Google 3D tiles; tweak these numbers rather than code.
 */
export interface AirportPreset {
  /** Which side of the runway (seen from the threshold looking down the runway) the tower camera stands. */
  towerSide: 'left' | 'right' | 'auto';
  /** Lateral distance from the centreline, metres. */
  towerOffsetM: number;
  /** Fraction of runway length from the threshold. */
  towerAlong: number;
  /** Eye height above ground, metres. */
  towerHeightM: number;
  /** Runway-end camera: distance before the landing threshold, lateral offset and height. */
  arrivalCam: { beforeM: number; sideM: number; heightM: number };
  /** Departure camera: along-runway fraction, lateral offset and height. */
  departureCam: { along: number; sideM: number; heightM: number };
  note?: string;
}

const DEFAULT: AirportPreset = {
  towerSide: 'auto',
  towerOffsetM: 450,
  towerAlong: 0.45,
  towerHeightM: 55,
  arrivalCam: { beforeM: 650, sideM: 90, heightM: 12 },
  departureCam: { along: 0.42, sideM: 170, heightM: 10 },
};

/** Curated presets: the 7 Indian launch airports and 5 international hubs. */
export const CURATED_PRESETS: Record<string, Partial<AirportPreset>> = {
  VIDP: { towerSide: 'left', towerOffsetM: 700, towerAlong: 0.5, towerHeightM: 100, note: 'Delhi: between the 10/28 and 11/29 complexes' },
  VABB: { towerSide: 'left', towerOffsetM: 420, towerAlong: 0.55, towerHeightM: 80, arrivalCam: { beforeM: 500, sideM: 70, heightM: 15 }, note: 'Mumbai: crossing runways, tight terminal area' },
  VOBL: { towerSide: 'right', towerOffsetM: 650, towerAlong: 0.5, towerHeightM: 60, note: 'Bengaluru: between the parallel 09/27 runways' },
  VOMM: { towerSide: 'left', towerOffsetM: 500, towerAlong: 0.45, towerHeightM: 55 },
  VECC: { towerSide: 'left', towerOffsetM: 600, towerAlong: 0.5, towerHeightM: 60 },
  VOHS: { towerSide: 'right', towerOffsetM: 700, towerAlong: 0.5, towerHeightM: 70, note: 'Hyderabad: parallel runways, tower between them' },
  VERP: { towerSide: 'left', towerOffsetM: 350, towerAlong: 0.5, towerHeightM: 35, arrivalCam: { beforeM: 450, sideM: 70, heightM: 8 }, note: 'Raipur: single runway, terminal north side' },
  OMDB: { towerSide: 'left', towerOffsetM: 650, towerAlong: 0.5, towerHeightM: 90, note: 'Dubai: between the parallel 12/30 runways' },
  EGLL: { towerSide: 'right', towerOffsetM: 700, towerAlong: 0.45, towerHeightM: 87, note: 'Heathrow: central terminal area between 09/27 runways' },
  WSSS: { towerSide: 'left', towerOffsetM: 800, towerAlong: 0.5, towerHeightM: 80 },
  KJFK: { towerSide: 'auto', towerOffsetM: 800, towerAlong: 0.5, towerHeightM: 98 },
  EDDF: { towerSide: 'right', towerOffsetM: 600, towerAlong: 0.5, towerHeightM: 70, note: 'Frankfurt: terminals south of 07C/25C' },
};

export function presetFor(icao: string): AirportPreset & { curated: boolean } {
  const c = CURATED_PRESETS[icao.toUpperCase()];
  return { ...DEFAULT, ...c, arrivalCam: { ...DEFAULT.arrivalCam, ...c?.arrivalCam }, departureCam: { ...DEFAULT.departureCam, ...c?.departureCam }, curated: !!c };
}

export interface GroundViewpoint {
  lat: number;
  lon: number;
  /** Height above ground at the viewpoint, metres. */
  heightAglM: number;
  /** Ground elevation (MSL feet) used as the reference for this point. */
  elevFt: number;
  label: string;
}

/** Point `along` metres down the runway from `end` and `side` metres to its right (negative = left). */
function runwayPoint(end: RunwayEnd, far: RunwayEnd, along: number, side: number) {
  const brg = bearingDeg(end.lat, end.lon, far.lat, far.lon);
  const p = destinationPoint(end.lat, end.lon, brg, along);
  return side === 0 ? p : destinationPoint(p.lat, p.lon, norm360(brg + (side > 0 ? 90 : -90)), Math.abs(side));
}

/** Side of the runway the airport reference point (usually near the terminal) is on: +1 right, −1 left. */
function terminalSide(airport: Airport, end: RunwayEnd, far: RunwayEnd): 1 | -1 {
  const brg = bearingDeg(end.lat, end.lon, far.lat, far.lon);
  const toArp = bearingDeg(end.lat, end.lon, airport.lat, airport.lon);
  const d = norm360(toArp - brg);
  return d > 0 && d < 180 ? 1 : -1;
}

export function towerViewpoint(airport: Airport, runway: Runway, end: RunwayEnd): GroundViewpoint {
  const far = end === runway.le ? runway.he : runway.le;
  const p = presetFor(airport.ident);
  const len = runway.lengthFt * FT_TO_M || haversineM(end.lat, end.lon, far.lat, far.lon);
  const side = p.towerSide === 'auto' ? terminalSide(airport, end, far) : p.towerSide === 'right' ? 1 : -1;
  const pt = runwayPoint(end, far, len * p.towerAlong, side * p.towerOffsetM);
  return { ...pt, heightAglM: p.towerHeightM, elevFt: (end.elevFt + far.elevFt) / 2, label: `${airport.iata ?? airport.ident} tower` };
}

/** Runway-end camera for an arrival (before the landing threshold) or departure (beside the rotation point). */
export function runwayViewpoint(airport: Airport, runway: Runway, end: RunwayEnd, kind: 'arrival' | 'departure'): GroundViewpoint {
  const far = end === runway.le ? runway.he : runway.le;
  const p = presetFor(airport.ident);
  const len = runway.lengthFt * FT_TO_M || haversineM(end.lat, end.lon, far.lat, far.lon);
  const side = terminalSide(airport, end, far);
  if (kind === 'arrival') {
    const pt = runwayPoint(end, far, -p.arrivalCam.beforeM, side * p.arrivalCam.sideM);
    return { ...pt, heightAglM: p.arrivalCam.heightM, elevFt: end.elevFt, label: `Runway ${end.ident} approach` };
  }
  const pt = runwayPoint(end, far, len * p.departureCam.along, side * p.departureCam.sideM);
  return { ...pt, heightAglM: p.departureCam.heightM, elevFt: (end.elevFt + far.elevFt) / 2, label: `Runway ${end.ident} departure` };
}
