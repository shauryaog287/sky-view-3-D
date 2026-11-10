/**
 * Airline paint schemes for the generated aircraft models: colours and where they go, nothing else — no logos, names
 * or livery artwork (those are trademarks; see NEEDS_FROM_ME §16 for licensed replicas). Approximate brand colours.
 *
 * Zones: `tail` (fin + winglets), `tail2` (upper band of the fin), `body` (fuselage tint, white by default), `belly`
 * (lower fuselage), `cheat` (line under the windows), `sweep` (tail colour running forward onto the rear fuselage,
 * as a fraction of the fuselage length) and `engine` (nacelles).
 */
import { AIRLINES } from './airlines';

export interface PaintScheme {
  tail: string;
  tail2?: string;
  body?: string;
  belly?: string;
  cheat?: string;
  sweep?: [string, number];
  engine?: string;
}

const S: Record<string, PaintScheme> = {
  // India
  IGO: { tail: '#1d3b8f', belly: '#1d3b8f', engine: '#1d3b8f' },
  AIC: { tail: '#c8102e', tail2: '#5f2167', sweep: ['#c8102e', 0.1], cheat: '#b8860b' },
  AXB: { tail: '#e4572e', tail2: '#00a3ad', sweep: ['#e4572e', 0.15], engine: '#e4572e' },
  IAD: { tail: '#e4572e', tail2: '#00a3ad', sweep: ['#e4572e', 0.15], engine: '#e4572e' },
  VTI: { tail: '#5f2167', engine: '#5f2167', cheat: '#b8860b' },
  SEJ: { tail: '#d52b1e', tail2: '#f7a800', sweep: ['#d52b1e', 0.16], engine: '#d52b1e' },
  AKJ: { tail: '#f15a22', tail2: '#4a2a7a', sweep: ['#4a2a7a', 0.12], engine: '#f15a22' },
  LLR: { tail: '#c8102e', cheat: '#c8102e' },
  SDG: { tail: '#1b365d', cheat: '#c8102e', engine: '#1b365d' },
  GOW: { tail: '#0a5aa8', belly: '#0a5aa8', engine: '#0a5aa8' },
  // Gulf and Middle East
  UAE: { tail: '#d71921', tail2: '#00732f' },
  QTR: { tail: '#5c0632', body: '#c9ccd2', engine: '#c9ccd2' },
  ETD: { tail: '#bd8b13', tail2: '#8a6a2a', body: '#efe6d3' },
  FDB: { tail: '#0d3c79', tail2: '#f58220', engine: '#0d3c79' },
  ABY: { tail: '#d6001c', engine: '#d6001c' },
  SVA: { tail: '#006c35', sweep: ['#006c35', 0.1], cheat: '#b8a36a', body: '#f3eedf' },
  OMA: { tail: '#a6192e', cheat: '#b8a36a' },
  GFA: { tail: '#b8a36a', tail2: '#a6192e', cheat: '#b8a36a' },
  KAC: { tail: '#00539f', cheat: '#00539f' },
  THY: { tail: '#c8102e', belly: '#d9dce1' },
  // Asia-Pacific
  SIA: { tail: '#1b365d', tail2: '#f2a900', cheat: '#1b365d' },
  THA: { tail: '#4b2e83', tail2: '#c2187a', sweep: ['#4b2e83', 0.13] },
  MAS: { tail: '#1b365d', tail2: '#c8102e', cheat: '#c8102e' },
  CPA: { tail: '#006564', belly: '#d9dce1' },
  ALK: { tail: '#b01c2e', tail2: '#1b4f9c' },
  BBC: { tail: '#006a4e', tail2: '#f42a41' },
  RNA: { tail: '#c8102e', tail2: '#1b365d' },
  ANA: { tail: '#13448f', cheat: '#13448f' },
  JAL: { tail: '#f2f3f5', tail2: '#c8102e' },
  KAL: { tail: '#7fbfe0', body: '#9fd0ea', belly: '#f2f3f5' },
  QFA: { tail: '#e0001a', sweep: ['#e0001a', 0.14] },
  // Europe
  BAW: { tail: '#1b365d', tail2: '#c8102e', belly: '#1b365d', engine: '#1b365d' },
  DLH: { tail: '#05164d', sweep: ['#05164d', 0.11] },
  AFR: { tail: '#002157', tail2: '#c8102e' },
  KLM: { tail: '#3d9ad9', body: '#5cb0e6', belly: '#f2f3f5', cheat: '#12357a' },
  VIR: { tail: '#e10a0a', engine: '#e10a0a' },
  SWR: { tail: '#d52b1e' },
  FIN: { tail: '#f2f3f5', tail2: '#0b1560' },
  // Americas
  UAL: { tail: '#0a3a7a', tail2: '#3d7fd0', belly: '#9fb3cc' },
  AAL: { tail: '#b61f2b', tail2: '#0a3a7a', body: '#cfd3d8', engine: '#cfd3d8' },
  DAL: { tail: '#0b2a5b', tail2: '#c8102e', belly: '#0b2a5b' },
  ACA: { tail: '#1a1a1a', tail2: '#c8102e', belly: '#1a1a1a' },
};

/** Paint scheme for an airline (ICAO code): a designed one, else just its brand colour on the tail. */
export function paintSchemeFor(icao: string | undefined): PaintScheme | undefined {
  if (!icao) return undefined;
  const code = icao.toUpperCase();
  if (S[code]) return S[code];
  const colour = AIRLINES.find((a) => a.icao === code)?.color;
  return colour ? { tail: colour } : undefined;
}

export const PAINT_SCHEMES: Readonly<Record<string, PaintScheme>> = S;
