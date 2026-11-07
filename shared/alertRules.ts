import type { FlightPhase } from './types';
import type { AlertCondition } from './apiTypes';

export const CONDITION_LABEL: Record<AlertCondition, string> = {
  takeoff: 'takes off',
  descent: 'starts descending',
  approach: 'is on final approach',
  landed: 'lands',
};

export interface AlertContext {
  /** Does the flight's destination / runway airport match the alert's airport? undefined = unknown. */
  airportMatch?: boolean;
  /** Height above the nearest field, ft. */
  aglFt?: number;
  /** Aircraft reports being on the ground (wheels down). */
  onGround?: boolean;
}

/**
 * Should an alert fire on this phase observation? `prev` is the phase at the previous evaluation (undefined on the
 * first observation). Used by the Worker cron (push) and by the in-app monitor (mock mode / no push).
 */
export function alertTriggered(cond: AlertCondition, prev: FlightPhase | undefined, next: FlightPhase, ctx: AlertContext = {}): boolean {
  const airportOk = ctx.airportMatch !== false;
  switch (cond) {
    case 'takeoff':
      return next === 'takeoff_roll' || (next === 'climb' && (prev === 'ground' || prev === 'takeoff_roll' || (prev === undefined && (ctx.aglFt ?? 1e9) < 3000)));
    case 'descent':
      return airportOk && (next === 'descent' || next === 'approach' || next === 'landing') && prev !== next && prev !== 'approach' && prev !== 'landing';
    case 'approach':
      return ctx.airportMatch !== false && (next === 'approach' || next === 'landing') && prev !== 'approach' && prev !== 'landing';
    case 'landed':
      // Touchdown (landing roll on the ground), or settled on the ground after an arrival.
      return airportOk && ((next === 'landing' && !!ctx.onGround) || (next === 'ground' && (prev === 'landing' || prev === 'approach' || prev === 'descent')));
  }
}
