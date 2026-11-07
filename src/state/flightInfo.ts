import { signal } from '@preact/signals';
import type { FlightInfo } from '../../shared/types';
import { api } from '../api';

/** Enrichment (route, airline, airframe) per hex, fetched lazily when a flight is selected. */
export const flightInfo = signal<Record<string, FlightInfo | 'loading' | 'error'>>({});
const inflight = new Set<string>();

export function ensureFlightInfo(hex: string, callsign?: string) {
  const key = `${hex}|${callsign ?? ''}`;
  const cur = flightInfo.value[hex];
  if ((cur && cur !== 'error' && (cur === 'loading' || cur.callsign === callsign)) || inflight.has(key)) return;
  inflight.add(key);
  flightInfo.value = { ...flightInfo.value, [hex]: 'loading' };
  api
    .info(hex, callsign)
    .then((info) => (flightInfo.value = { ...flightInfo.value, [hex]: info }))
    .catch(() => (flightInfo.value = { ...flightInfo.value, [hex]: 'error' }))
    .finally(() => inflight.delete(key));
}
