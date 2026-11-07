import type { AirportIndex } from '../../shared/airports';

let promise: Promise<AirportIndex> | undefined;

/** Lazy-load the bundled OurAirports dataset (~370 KB gzipped) in its own chunk. */
export function loadAirports(): Promise<AirportIndex> {
  promise ??= import('../../shared/airportData').then((m) => m.airportIndex());
  return promise;
}
