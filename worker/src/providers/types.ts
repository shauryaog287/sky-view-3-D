import type { AircraftState, ProviderId } from '../../../shared/types';
import type { BBox } from '../../../shared/geo';

export type ProviderQuery =
  | { kind: 'point'; lat: number; lon: number; radiusNm: number }
  | { kind: 'bbox'; bbox: BBox }
  | { kind: 'callsign'; callsign: string }
  | { kind: 'hex'; hex: string }
  | { kind: 'reg'; reg: string };

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  /** Token bucket parameters for this provider's upstream limit. */
  readonly limits: { capacity: number; refillPerSec: number };
  /** Whether the provider's terms allow use in a paid product. Community feeds do not. */
  readonly commercialUseAllowed: boolean;
  readonly attribution: string;
  supports(kind: ProviderQuery['kind']): boolean;
  /** Token cost of a query (OpenSky charges more credits for bigger areas). */
  cost(q: ProviderQuery): number;
  fetch(q: ProviderQuery, signal?: AbortSignal): Promise<AircraftState[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type FetchLike = (input: string | Request, init?: RequestInit) => Promise<Response>;

export function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : undefined;
}

export const USER_AGENT = 'SkyView3D/0.1 (+https://github.com/shauryaog287/sky-view-3-D)';

/** Workers' global fetch must be called unbound; storing `fetch` on an object breaks it ("Illegal invocation"). */
export const globalFetch: FetchLike = (input, init) => fetch(input, init);
