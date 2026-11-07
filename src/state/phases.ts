import { signal } from '@preact/signals';
import type { FlightPhase } from '../../shared/types';

/** Latest detected phase per aircraft (updated by the phase tracker a few times per second). */
export const flightPhases = signal<Record<string, FlightPhase>>({});

export interface RunwayLabel {
  /** Runway end designator, e.g. "29L". */
  ident: string;
  /** IATA (or ICAO) code of the airport. */
  airport: string;
  kind: 'arr' | 'dep';
  /** aligned = lined up / rolling; traffic = runway in use (learned); wind / geometry = best guess. */
  source: 'aligned' | 'traffic' | 'wind' | 'geometry';
}

/** Landing / departure runway per aircraft (only for aircraft near an airport). */
export const flightRunways = signal<Record<string, RunwayLabel>>({});

export const PHASE_LABEL: Record<FlightPhase, string> = {
  ground: 'On ground',
  takeoff_roll: 'Takeoff roll',
  climb: 'Climbing',
  cruise: 'Cruise',
  descent: 'Descending',
  approach: 'On approach',
  landing: 'Landing',
  unknown: 'Unknown',
};
