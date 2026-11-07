import type { AircraftState, ProviderId } from './types';

/** A single aircraft object in the readsb / tar1090 "v2" API format used by adsb.lol and airplanes.live. */
export interface ReadsbAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  category?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  track_rate?: number;
  roll?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  seen?: number;
  mlat?: unknown[];
}

export interface ReadsbResponse {
  now?: number;
  ac?: ReadsbAircraft[] | null;
  msg?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Normalise one readsb v2 aircraft. Returns undefined when it has no usable position. */
export function parseReadsbAircraft(a: ReadsbAircraft, nowMs: number, source: ProviderId): AircraftState | undefined {
  if (!a || typeof a.hex !== 'string' || !isNum(a.lat) || !isNum(a.lon)) return undefined;
  if (Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) return undefined;
  const onGround = a.alt_baro === 'ground';
  const seenPos = isNum(a.seen_pos) ? a.seen_pos : isNum(a.seen) ? a.seen : 0;
  const seen = isNum(a.seen) ? a.seen : seenPos;
  const callsign = typeof a.flight === 'string' ? a.flight.trim() || undefined : undefined;
  const vrate = isNum(a.geom_rate) ? a.geom_rate : isNum(a.baro_rate) ? a.baro_rate : undefined;
  const st: AircraftState = {
    hex: a.hex.toLowerCase(),
    lat: a.lat,
    lon: a.lon,
    onGround,
    posTs: Math.round(nowMs - seenPos * 1000),
    seenTs: Math.round(nowMs - seen * 1000),
    source,
  };
  if (callsign) st.callsign = callsign;
  if (a.r) st.reg = a.r;
  if (a.t) st.type = a.t;
  if (a.category) st.category = a.category;
  if (isNum(a.alt_baro)) st.altBaro = a.alt_baro;
  if (isNum(a.alt_geom)) st.altGeom = a.alt_geom;
  if (isNum(a.gs)) st.gs = a.gs;
  const track = isNum(a.track) ? a.track : isNum(a.true_heading) ? a.true_heading : undefined;
  if (track !== undefined) st.track = track;
  if (isNum(a.track_rate)) st.trackRate = a.track_rate;
  if (isNum(a.roll)) st.roll = a.roll;
  if (vrate !== undefined) st.vrate = onGround ? 0 : vrate;
  if (a.squawk) st.squawk = a.squawk;
  if (a.emergency && a.emergency !== 'none') st.emergency = a.emergency;
  if (Array.isArray(a.mlat) && a.mlat.length > 0) st.mlat = true;
  return st;
}

export function parseReadsbResponse(body: ReadsbResponse, source: ProviderId, fallbackNow = Date.now()): AircraftState[] {
  const now = isNum(body?.now) ? body.now : fallbackNow;
  const out: AircraftState[] = [];
  for (const a of body?.ac ?? []) {
    const s = parseReadsbAircraft(a, now, source);
    if (s) out.push(s);
  }
  return out;
}
