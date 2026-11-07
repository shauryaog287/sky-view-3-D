import { signal } from '@preact/signals';
import type { FlightPhase } from '../../shared/types';

/** Latest detected phase per aircraft (updated by the phase tracker a few times per second). */
export const flightPhases = signal<Record<string, FlightPhase>>({});

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
