import { AirportIndex, type CompactAirportFile } from './airports';
import data from '../data/airports.json';

let index: AirportIndex | undefined;

/** The bundled OurAirports dataset as a spatial index (built once, lazily). */
export function airportIndex(): AirportIndex {
  if (!index) index = AirportIndex.fromCompact(data as unknown as CompactAirportFile);
  return index;
}
