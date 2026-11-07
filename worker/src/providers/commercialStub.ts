import type { AircraftState } from '../../../shared/types';
import { ProviderError, type ProviderAdapter, type ProviderQuery } from './types';

/**
 * Placeholder for a licensed, commercial-use flight data feed.
 *
 * WHY: adsb.lol, airplanes.live and OpenSky are free for non-commercial use only. Once SkyView 3D charges money
 * (LAUNCH_MODE=freemium with live payments) the live map must be fed by a licensed source.
 *
 * TODO(commercial-feed): implement against the chosen vendor, e.g.
 *   - FlightAware AeroAPI  (https://www.flightaware.com/aeroapi/)  — flights/search, positions; per-query pricing
 *   - Aviation Edge        (https://aviation-edge.com/)             — flights tracker API by bbox / flight number
 *   - ADS-B Exchange Enterprise / Spire Aviation / Cirium SkyStream — bulk feeds
 * Map the vendor's JSON to AircraftState (see shared/types.ts) and set realistic `limits`.
 * Switch with env: PROVIDERS=commercial (or "commercial,adsblol" for a mixed fallback during migration).
 */
export class CommercialProviderStub implements ProviderAdapter {
  readonly id = 'commercial' as const;
  readonly label: string;
  readonly limits = { capacity: 5, refillPerSec: 2 };
  readonly commercialUseAllowed = true;
  readonly attribution: string;

  constructor(
    private readonly vendor: string | undefined,
    private readonly apiKey: string | undefined,
  ) {
    this.label = vendor ? `Commercial feed (${vendor})` : 'Commercial feed (not configured)';
    this.attribution = vendor ?? 'Licensed flight data provider';
  }

  supports(kind: ProviderQuery['kind']): boolean {
    return kind === 'point' || kind === 'bbox' || kind === 'callsign' || kind === 'hex' || kind === 'reg';
  }

  cost(): number {
    return 1;
  }

  async fetch(_q: ProviderQuery): Promise<AircraftState[]> {
    if (!this.vendor || !this.apiKey) throw new ProviderError('commercial provider not configured', 503);
    throw new ProviderError(`commercial provider "${this.vendor}" not implemented yet`, 501);
  }
}
