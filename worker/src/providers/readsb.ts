import { parseReadsbResponse, type ReadsbResponse } from '../../../shared/readsb';
import type { AircraftState, ProviderId } from '../../../shared/types';
import { globalFetch, ProviderError, retryAfterMs, USER_AGENT, type FetchLike, type ProviderAdapter, type ProviderQuery } from './types';

/**
 * Adapter for readsb "v2"-style REST APIs (adsb.lol, airplanes.live). Same schema, different hosts and limits.
 * Supports point/radius (≤ 250 NM), callsign, hex and registration queries.
 */
export class ReadsbV2Provider implements ProviderAdapter {
  readonly commercialUseAllowed = false;

  constructor(
    readonly id: ProviderId,
    readonly label: string,
    private readonly baseUrl: string,
    readonly limits: { capacity: number; refillPerSec: number },
    readonly attribution: string,
    private readonly fetchImpl: FetchLike = globalFetch,
    private readonly timeoutMs = 8000,
  ) {}

  supports(kind: ProviderQuery['kind']): boolean {
    return kind !== 'bbox';
  }

  cost(): number {
    return 1;
  }

  private path(q: ProviderQuery): string {
    switch (q.kind) {
      case 'point':
        return `/point/${q.lat.toFixed(4)}/${q.lon.toFixed(4)}/${Math.min(250, Math.max(1, Math.round(q.radiusNm)))}`;
      case 'callsign':
        return `/callsign/${encodeURIComponent(q.callsign.toUpperCase())}`;
      case 'hex':
        return `/hex/${encodeURIComponent(q.hex.toLowerCase())}`;
      case 'reg':
        return `/reg/${encodeURIComponent(q.reg.toUpperCase())}`;
      default:
        throw new ProviderError(`${this.id} does not support ${q.kind}`);
    }
  }

  async fetch(q: ProviderQuery, signal?: AbortSignal): Promise<AircraftState[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${this.path(q)}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: ctrl.signal,
      });
      if (res.status === 429) throw new ProviderError(`${this.id} rate limited`, 429, retryAfterMs(res));
      if (!res.ok) throw new ProviderError(`${this.id} HTTP ${res.status}`, res.status, retryAfterMs(res));
      const body = (await res.json()) as ReadsbResponse;
      return parseReadsbResponse(body, this.id);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(`${this.id} ${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function adsbLolProvider(fetchImpl?: FetchLike, baseUrl = 'https://api.adsb.lol/v2') {
  // adsb.lol asks for "reasonable" use; ~1 req/s sustained with a small burst has been reliable.
  return new ReadsbV2Provider('adsblol', 'adsb.lol', baseUrl, { capacity: 3, refillPerSec: 0.8 }, 'adsb.lol (ODbL 1.0)', fetchImpl);
}

export function airplanesLiveProvider(fetchImpl?: FetchLike, baseUrl = 'https://api.airplanes.live/v2') {
  // airplanes.live documents a limit of 1 request per second.
  return new ReadsbV2Provider('airplaneslive', 'airplanes.live', baseUrl, { capacity: 1, refillPerSec: 1 }, 'airplanes.live', fetchImpl);
}
