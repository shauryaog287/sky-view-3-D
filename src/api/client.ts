import type { BBox } from '../../shared/geo';
import type { FlightInfo, RegionResponse, SearchResult, TrackPoint, WeatherInfo } from '../../shared/types';
import type { AppConfig, EntitlementResponse, TilesSessionResponse } from '../../shared/api';
import type { AlertCondition, AlertRecord, CheckoutStart, CreateAlertInput, UsageEvent } from '../../shared/apiTypes';

/** Everything the UI may ask the backend. Implemented by HttpApiClient (real Worker) and MockApiClient (in-browser). */
export interface ApiClient {
  readonly mode: 'http' | 'mock';
  config(): Promise<AppConfig>;
  region(bbox: BBox, signal?: AbortSignal): Promise<RegionResponse>;
  search(q: string): Promise<SearchResult>;
  info(hex: string, callsign?: string): Promise<FlightInfo>;
  weather(lat: number, lon: number): Promise<WeatherInfo>;
  track(hex: string, minutes: number): Promise<TrackPoint[]>;
  tilesSession(): Promise<TilesSessionResponse>;
  listAlerts(): Promise<AlertRecord[]>;
  createAlert(input: CreateAlertInput): Promise<AlertRecord>;
  deleteAlert(id: string): Promise<void>;
  entitlements(): Promise<EntitlementResponse>;
  startCheckout(planId: string): Promise<CheckoutStart>;
  confirmCheckout(payload: Record<string, string>): Promise<EntitlementResponse>;
  cancelSubscription(): Promise<EntitlementResponse>;
  sendUsage(events: UsageEvent[]): Promise<void>;
  setAuthToken(token: string | undefined): void;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type { AlertCondition };
