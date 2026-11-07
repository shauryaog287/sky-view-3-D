import { airlineByIata, airlineByIcao } from './airlines';
import type { AircraftState } from './types';

export interface SearchPlan {
  raw: string;
  callsigns: string[];
  hexes: string[];
  regs: string[];
}

/**
 * Turn whatever the user typed into concrete lookups.
 *  "6E-2134" / "6e 2134" → callsign IGO2134 (and 6E2134)
 *  "IGO2134"             → callsign
 *  "VT-NHC" / "N123AB"   → registration
 *  "801822"              → ICAO hex (also tried as callsign when it could be one)
 */
export function planSearch(input: string): SearchPlan {
  const raw = input.trim().toUpperCase();
  const compact = raw.replace(/[\s-]/g, '');
  const plan: SearchPlan = { raw, callsigns: [], hexes: [], regs: [] };
  if (!compact) return plan;
  const add = (arr: string[], v: string) => {
    if (v && !arr.includes(v)) arr.push(v);
  };

  // IATA flight number: 2-char designator (letters/digits, at least one letter) + 1-4 digits + optional suffix.
  const iata = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(compact);
  if (iata && /[A-Z]/.test(iata[1])) {
    const al = airlineByIata(iata[1]);
    if (al) add(plan.callsigns, al.icao + stripZeros(iata[2]));
    add(plan.callsigns, compact);
  }
  // ICAO callsign: 3 letters + 1-4 digits/letters.
  const icao = /^([A-Z]{3})(\d[A-Z0-9]{0,4})$/.exec(compact);
  if (icao) {
    add(plan.callsigns, icao[1] + stripZeros(icao[2]));
    add(plan.callsigns, compact);
    if (!airlineByIcao(icao[1]) && /^\d+$/.test(icao[2]) === false) add(plan.regs, compact);
  }
  // ICAO 24-bit hex.
  if (/^~?[0-9A-F]{6}$/.test(compact)) add(plan.hexes, compact.toLowerCase());
  // Registration: has a dash, or US N-number, or otherwise looks like letters+digits without matching a flight.
  if (raw.includes('-') && /^[A-Z0-9]{1,3}-[A-Z0-9]{1,5}$/.test(raw)) add(plan.regs, raw);
  if (/^N\d{1,5}[A-Z]{0,2}$/.test(compact)) add(plan.regs, compact);
  // Fall back to treating anything else as a free callsign.
  if (!plan.callsigns.length && !plan.hexes.length && !plan.regs.length && /^[A-Z0-9]{2,8}$/.test(compact)) {
    add(plan.callsigns, compact);
  }
  return plan;
}

function stripZeros(num: string): string {
  // Airlines file "IGO0123" as "IGO123"; leading zeros are rarely used in ADS-B callsigns.
  return num.replace(/^0+(?=\d)/, '');
}

/** Does an aircraft match a plan? Used to search already-loaded aircraft instantly. */
export function matchesPlan(a: AircraftState, p: SearchPlan): boolean {
  const cs = a.callsign?.toUpperCase();
  if (cs && (p.callsigns.includes(cs) || (p.raw.length >= 3 && cs.startsWith(p.raw.replace(/[\s-]/g, ''))))) return true;
  if (p.hexes.includes(a.hex)) return true;
  const reg = a.reg?.toUpperCase();
  if (reg && (p.regs.includes(reg) || p.regs.includes(reg.replace('-', '')) || reg.replace('-', '') === p.raw.replace(/[\s-]/g, ''))) return true;
  return false;
}
