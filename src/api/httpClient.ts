import type { BBox } from '../../shared/geo';
import type { FlightInfo, RegionResponse, SearchResult, TrackPoint, WeatherInfo } from '../../shared/types';
import type { AppConfig, EntitlementResponse, TilesSessionResponse } from '../../shared/api';
import type { AlertRecord, CheckoutStart, CreateAlertInput, UsageEvent } from '../../shared/apiTypes';
import { ApiError, type ApiClient } from './client';
import { deviceId } from '../lib/device';

/** Talks to the SkyView Worker API. The browser never calls flight data providers directly. */
export class HttpApiClient implements ApiClient {
  readonly mode = 'http' as const;
  private token?: string;

  constructor(private readonly base: string) {}

  setAuthToken(token: string | undefined) {
    this.token = token;
  }

  private async req<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
    init.signal?.addEventListener('abort', () => ctrl.abort());
    const headers = new Headers(init.headers);
    headers.set('X-Device-Id', deviceId());
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    try {
      const res = await fetch(`${this.base}${path}`, { ...init, headers, signal: ctrl.signal });
      const text = await res.text();
      const body = text ? (JSON.parse(text) as unknown) : undefined;
      if (!res.ok) {
        const b = (body ?? {}) as { error?: string; message?: string };
        throw new ApiError(res.status, b.error ?? 'http_error', b.message ?? `HTTP ${res.status}`);
      }
      return body as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as Error).name === 'AbortError') throw new ApiError(0, 'timeout', 'The server took too long to answer');
      if (e instanceof SyntaxError) throw new ApiError(502, 'bad_response', 'The server sent an unexpected response');
      throw new ApiError(0, 'network', navigator.onLine ? 'Could not reach the SkyView server' : 'You are offline');
    } finally {
      clearTimeout(timer);
    }
  }

  config() {
    return this.req<AppConfig>('/api/config');
  }
  region(b: BBox, signal?: AbortSignal) {
    const bbox = [b.minLon, b.minLat, b.maxLon, b.maxLat].map((x) => x.toFixed(3)).join(',');
    return this.req<RegionResponse>(`/api/aircraft?bbox=${bbox}`, { signal });
  }
  search(q: string) {
    return this.req<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`);
  }
  info(hex: string, callsign?: string) {
    const qs = callsign ? `?callsign=${encodeURIComponent(callsign)}` : '';
    return this.req<FlightInfo>(`/api/info/${encodeURIComponent(hex)}${qs}`);
  }
  weather(lat: number, lon: number) {
    return this.req<WeatherInfo>(`/api/weather?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
  }
  track(hex: string, minutes: number) {
    return this.req<{ points: TrackPoint[] }>(`/api/track/${encodeURIComponent(hex)}?minutes=${minutes}`).then((r) => r.points);
  }
  tilesSession() {
    return this.req<TilesSessionResponse>('/api/tiles/session', { method: 'POST', body: '{}' });
  }
  listAlerts() {
    return this.req<{ alerts: AlertRecord[] }>('/api/alerts').then((r) => r.alerts);
  }
  createAlert(input: CreateAlertInput) {
    return this.req<AlertRecord>('/api/alerts', { method: 'POST', body: JSON.stringify(input) });
  }
  async deleteAlert(id: string) {
    await this.req(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  entitlements() {
    return this.req<EntitlementResponse>('/api/me/entitlements');
  }
  startCheckout(planId: string) {
    return this.req<CheckoutStart>('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ planId }) });
  }
  confirmCheckout(payload: Record<string, string>) {
    return this.req<EntitlementResponse>('/api/billing/confirm', { method: 'POST', body: JSON.stringify(payload) });
  }
  cancelSubscription() {
    return this.req<EntitlementResponse>('/api/billing/cancel', { method: 'POST', body: '{}' });
  }
  async sendUsage(events: UsageEvent[]) {
    await this.req('/api/events', { method: 'POST', body: JSON.stringify({ events }), keepalive: true, timeoutMs: 5000 });
  }
}
