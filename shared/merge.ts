import type { AircraftState } from './types';

/**
 * Merge aircraft from several sources/buckets by ICAO hex. The freshest *position* wins; fields that the winner
 * lacks (registration, type, callsign...) are filled from the other reports so enrichment is not lost.
 */
export function mergeAircraft(...lists: AircraftState[][]): AircraftState[] {
  const byHex = new Map<string, AircraftState>();
  for (const list of lists) {
    for (const a of list) {
      const prev = byHex.get(a.hex);
      if (!prev) {
        byHex.set(a.hex, a);
        continue;
      }
      const [winner, loser] = a.posTs > prev.posTs ? [a, prev] : [prev, a];
      byHex.set(a.hex, fillMissing(winner, loser));
    }
  }
  return [...byHex.values()];
}

const FILLABLE: (keyof AircraftState)[] = ['callsign', 'reg', 'type', 'category', 'squawk', 'altGeom', 'altBaro', 'gs', 'track', 'vrate'];

function fillMissing(winner: AircraftState, loser: AircraftState): AircraftState {
  let out = winner;
  for (const k of FILLABLE) {
    if (winner[k] === undefined && loser[k] !== undefined) {
      if (out === winner) out = { ...winner };
      (out as unknown as Record<string, unknown>)[k] = loser[k];
    }
  }
  if (loser.seenTs > out.seenTs) {
    if (out === winner) out = { ...winner };
    out.seenTs = loser.seenTs;
  }
  return out;
}

/** Drop aircraft whose position is older than `maxAgeMs` relative to `now`. */
export function dropStale(list: AircraftState[], now: number, maxAgeMs: number): AircraftState[] {
  return list.filter((a) => now - a.posTs <= maxAgeMs);
}
