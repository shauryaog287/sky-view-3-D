/**
 * India-first rollout order for airport scenery and checks: the international airports first (busiest first), then
 * every other Indian airport with airline service (large/medium airports that have an IATA code).
 */
import type { AirportIndex, Airport } from './airports';

export const INDIA_INTERNATIONAL = [
  'VIDP', 'VABB', 'VOBL', 'VOHS', 'VOMM', 'VECC', 'VANM', 'VOCI', 'VAAH', 'VOGO', 'VOGA', 'VAPO', 'VILK', 'VIJP',
  'VOTV', 'VOCL', 'VEGT', 'VIAR', 'VEBS', 'VANP', 'VOCB', 'VOML', 'VEBN', 'VISR', 'VAID', 'VEBD', 'VOVI', 'VOTR',
  'VICG', 'VOKN', 'VOMD', 'VEIM', 'VOBZ', 'VOTP', 'VOPB', 'VASU', 'VEGY', 'VERP', 'VEAT',
];

export function indiaDomestic(index: AirportIndex): Airport[] {
  const intl = new Set(INDIA_INTERNATIONAL);
  return index.airports.filter((a) => a.country === 'IN' && (a.kind === 'L' || a.kind === 'M') && !!a.iata && !intl.has(a.ident)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'L' ? -1 : 1));
}
