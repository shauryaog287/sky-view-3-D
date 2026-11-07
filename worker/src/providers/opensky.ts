import type { AircraftState } from '../../../shared/types';
import type { BBox } from '../../../shared/geo';
import { NM_TO_M, M_TO_FT, MS_TO_KT } from '../../../shared/geo';
import { globalFetch, ProviderError, retryAfterMs, USER_AGENT, type FetchLike, type ProviderAdapter, type ProviderQuery } from './types';

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const API = 'https://opensky-network.org/api';

const CATEGORY: Record<number, string> = { 2: 'A1', 3: 'A2', 4: 'A3', 5: 'A4', 6: 'A5', 7: 'A6', 8: 'A7', 9: 'B1', 10: 'B2', 11: 'B3', 12: 'B4', 14: 'B6', 15: 'B7' };

type StateVector = [
  string, string | null, string, number | null, number, number | null, number | null, number | null, boolean,
  number | null, number | null, number | null, unknown, number | null, string | null, boolean, number, number?,
];

/**
 * OpenSky Network REST API with OAuth2 client-credentials.
 * Credit-based limits: a /states/all call costs 1–4 credits depending on the bbox area (4,000 credits/day by default).
 * Supports bbox (great for zoomed-out views) and hex. Callsign search is not offered by the API.
 */
export class OpenSkyProvider implements ProviderAdapter {
  readonly id = 'opensky' as const;
  readonly label = 'OpenSky Network';
  readonly commercialUseAllowed = false;
  readonly attribution = 'The OpenSky Network, https://opensky-network.org';
  readonly limits: { capacity: number; refillPerSec: number };
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = globalFetch,
    dailyCredits = 4000,
    private readonly now: () => number = Date.now,
  ) {
    this.limits = { capacity: Math.min(60, dailyCredits / 50), refillPerSec: dailyCredits / 86_400 };
  }

  supports(kind: ProviderQuery['kind']): boolean {
    return kind === 'bbox' || kind === 'point' || kind === 'hex';
  }

  cost(q: ProviderQuery): number {
    const b = q.kind === 'bbox' ? q.bbox : q.kind === 'point' ? pointBox(q.lat, q.lon, q.radiusNm) : undefined;
    if (!b) return 4;
    const area = Math.abs(b.maxLat - b.minLat) * Math.abs((b.maxLon - b.minLon + 360) % 360 || 360);
    return area <= 25 ? 1 : area <= 100 ? 2 : area <= 400 ? 3 : 4;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body,
    });
    if (!res.ok) throw new ProviderError(`opensky auth HTTP ${res.status}`, res.status);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: this.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async fetch(q: ProviderQuery, signal?: AbortSignal): Promise<AircraftState[]> {
    const params = new URLSearchParams({ extended: '1' });
    if (q.kind === 'hex') params.set('icao24', q.hex.replace('~', '').toLowerCase());
    else {
      const b = q.kind === 'bbox' ? q.bbox : q.kind === 'point' ? pointBox(q.lat, q.lon, q.radiusNm) : undefined;
      if (!b) throw new ProviderError(`opensky does not support ${q.kind}`);
      params.set('lamin', b.minLat.toFixed(3));
      params.set('lomin', b.minLon.toFixed(3));
      params.set('lamax', b.maxLat.toFixed(3));
      params.set('lomax', b.maxLon.toFixed(3));
    }
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${API}/states/all?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal,
    });
    if (res.status === 401) this.token = undefined;
    if (res.status === 429) {
      const ra = Number(res.headers.get('x-rate-limit-retry-after-seconds'));
      throw new ProviderError('opensky credits exhausted', 429, Number.isFinite(ra) && ra > 0 ? ra * 1000 : retryAfterMs(res));
    }
    if (!res.ok) throw new ProviderError(`opensky HTTP ${res.status}`, res.status);
    const j = (await res.json()) as { time: number; states: StateVector[] | null };
    return (j.states ?? []).map(parseOpenSkyState).filter((a): a is AircraftState => !!a);
  }
}

export function parseOpenSkyState(s: StateVector): AircraftState | undefined {
  const [icao24, callsign, , timePos, lastContact, lon, lat, baroM, onGround, velMs, track, vrMs, , geoM, squawk, , , cat] = s;
  if (lat === null || lon === null || timePos === null) return undefined;
  const st: AircraftState = {
    hex: icao24.toLowerCase(),
    lat,
    lon,
    onGround,
    posTs: timePos * 1000,
    seenTs: lastContact * 1000,
    source: 'opensky',
  };
  const cs = callsign?.trim();
  if (cs) st.callsign = cs;
  if (baroM !== null && !onGround) st.altBaro = Math.round(baroM * M_TO_FT);
  if (geoM !== null) st.altGeom = Math.round(geoM * M_TO_FT);
  if (velMs !== null) st.gs = Math.round(velMs * MS_TO_KT * 10) / 10;
  if (track !== null) st.track = track;
  if (vrMs !== null) st.vrate = Math.round(vrMs * M_TO_FT * 60);
  if (squawk) st.squawk = squawk;
  if (cat !== undefined && CATEGORY[cat]) st.category = CATEGORY[cat];
  return st;
}

function pointBox(lat: number, lon: number, radiusNm: number): BBox {
  const dLat = (radiusNm * NM_TO_M) / 111_000;
  const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}
