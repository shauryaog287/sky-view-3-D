import type { BBox } from '../../shared/geo';
import { bboxCenter, haversineM, inBBox } from '../../shared/geo';
import type { AircraftState, FlightInfo, RegionResponse, SearchResult, TrackPoint, WeatherInfo } from '../../shared/types';
import type { AppConfig, EntitlementResponse, TilesSessionResponse } from '../../shared/api';
import type { AlertRecord, CheckoutStart, CreateAlertInput, UsageEvent } from '../../shared/apiTypes';
import type { FlightSimulator } from '../../shared/simulator';
import type { AirportIndex } from '../../shared/airports';
import { matchesPlan, planSearch } from '../../shared/search';
import { airlineFromCallsign } from '../../shared/airlines';
import { allFeatureAccess, parseLaunchMode } from '../config/features';
import { PLANS } from '../config/plans';
import { env } from '../config/env';
import { readPref, writePref } from '../lib/device';
import { ApiError, type ApiClient } from './client';

/**
 * In-browser backend used in mock mode (`npm run dev:mock`, Playwright, demos).
 * Recorded real ADS-B fixtures + scripted takeoffs/landings, animated by the shared simulator.
 * Every endpoint is implemented so every screen works with zero keys and zero network.
 */
export class MockApiClient implements ApiClient {
  readonly mode = 'mock' as const;
  private sim?: Promise<{ sim: FlightSimulator; airports: AirportIndex }>;
  private alerts: AlertRecord[] = readPref<AlertRecord[]>('mock_alerts', []);
  /** Mock-only time shift (?simShift=seconds) to jump scripted flights to an interesting moment for demos/tests. */
  private readonly shiftMs = (() => {
    try {
      return (Number(new URLSearchParams(location.search).get('simShift')) || 0) * 1000;
    } catch {
      return 0;
    }
  })();

  private now() {
    return Date.now() + this.shiftMs;
  }

  setAuthToken() {}

  private load() {
    this.sim ??= (async () => {
      const [{ FlightSimulator, defaultScriptedFlights }, { FIXTURE_SNAPSHOTS }, { loadAirports }] = await Promise.all([
        import('../../shared/simulator'),
        import('../../shared/fixtures'),
        import('../data/airports'),
      ]);
      const airports = await loadAirports();
      return { sim: new FlightSimulator(FIXTURE_SNAPSHOTS, defaultScriptedFlights(airports), { noiseM: 6 }), airports };
    })();
    return this.sim;
  }

  private async all(): Promise<AircraftState[]> {
    const { sim } = await this.load();
    return sim.snapshot(this.now());
  }

  async config(): Promise<AppConfig> {
    return {
      version: 'mock',
      launchMode: parseLaunchMode(readPref<string>('mock_launch_mode', env.launchMode)),
      tierOverrides: {},
      plans: PLANS,
      payments: { enabled: true, provider: 'none', testMode: true },
      auth: { enabled: false },
      tiles: { mode: env.cesiumIonToken ? 'ion' : 'off' },
      providers: [{ id: 'fixture', label: 'Recorded sample data', attribution: 'Sample data recorded from adsb.lol (ODbL 1.0)', commercialUseAllowed: false }],
    };
  }

  async region(b: BBox): Promise<RegionResponse> {
    const now = this.now();
    const c = bboxCenter(b);
    let list = (await this.all()).filter((a) => inBBox(b, a.lat, a.lon));
    const truncated = list.length > 400;
    if (truncated) {
      list = list.sort((x, y) => haversineM(c.lat, c.lon, x.lat, x.lon) - haversineM(c.lat, c.lon, y.lat, y.lon)).slice(0, 400);
    }
    return {
      now,
      aircraft: list,
      buckets: [{ id: 'mock', ageMs: 0, count: list.length }],
      truncated,
      stale: false,
      providers: [{ id: 'fixture', enabled: true, ok: true, lastSuccess: now }],
    };
  }

  async search(q: string): Promise<SearchResult> {
    const plan = planSearch(q);
    return { query: plan.raw, candidates: plan.callsigns, aircraft: (await this.all()).filter((a) => matchesPlan(a, plan)) };
  }

  async info(hex: string, callsign?: string): Promise<FlightInfo> {
    const { sim, airports } = await this.load();
    const script = sim.scripted.find((f) => f.hex === hex);
    const al = airlineFromCallsign(callsign);
    const info: FlightInfo = { hex, callsign, source: 'Sample data' };
    if (al) info.airline = { name: al.name, icao: al.icao, iata: al.iata };
    if (script) {
      const ap = airports.get(script.airportIcao);
      const other = airports.get(script.kind === 'arrival' ? 'VABB' : 'VIDP');
      const ref = (a?: typeof ap) => (a ? { icao: a.ident, iata: a.iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon } : undefined);
      info.airline = { name: 'SkyView Demo', icao: 'SKV' };
      info.origin = ref(script.kind === 'arrival' ? other : ap);
      info.destination = ref(script.kind === 'arrival' ? ap : other);
      info.aircraft = { icaoType: script.type, reg: script.reg };
    }
    return info;
  }

  async weather(lat: number, lon: number): Promise<WeatherInfo> {
    const { airports } = await this.load();
    const near = airports.nearest(lat, lon, 200_000);
    // Deterministic pseudo-weather so screenshots are stable but places differ.
    const seed = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233)) % 1;
    const cover = Math.round(seed * 100);
    const base = 1500 + Math.round(seed * 6000);
    const coverCode = cover < 15 ? 'FEW' : cover < 45 ? 'SCT' : cover < 80 ? 'BKN' : 'OVC';
    return {
      lat,
      lon,
      fetchedAt: Date.now(),
      cloudCover: cover,
      cloudLow: cover,
      visibilityM: 4000 + Math.round((1 - seed) * 20000),
      windDir: Math.round(seed * 360),
      windKt: 5 + Math.round(seed * 15),
      tempC: 24,
      metar: near
        ? {
            station: near.airport.ident,
            raw: `METAR ${near.airport.ident} (sample) ${coverCode}${String(Math.round(base / 100)).padStart(3, '0')}`,
            obsTime: Date.now() - 20 * 60_000,
            visibilityM: 6000,
            clouds: [{ cover: coverCode, baseFt: base }],
            flightCategory: 'VFR',
          }
        : undefined,
      sources: ['Sample weather (mock mode)'],
    };
  }

  async track(hex: string, minutes: number): Promise<TrackPoint[]> {
    const { sim } = await this.load();
    const now = this.now();
    return sim.history(hex, now - minutes * 60_000, now, 15_000).map((a) => ({
      hex,
      ts: a.posTs,
      lat: a.lat,
      lon: a.lon,
      alt: a.onGround ? null : (a.altBaro ?? a.altGeom ?? null),
      gs: a.gs ?? null,
      track: a.track ?? null,
      vrate: a.vrate ?? null,
    }));
  }

  async tilesSession(): Promise<TilesSessionResponse> {
    return env.cesiumIonToken
      ? { allowed: true, mode: 'ion' }
      : { allowed: false, mode: 'off', reason: 'Mock mode: no Google / Cesium ion key configured' };
  }

  async listAlerts() {
    return this.alerts;
  }

  async createAlert(input: CreateAlertInput): Promise<AlertRecord> {
    const now = Date.now();
    const rec: AlertRecord = {
      id: crypto.randomUUID(),
      hex: input.hex,
      callsign: input.callsign,
      label: input.label,
      condition: input.condition,
      airport: input.airport,
      createdAt: now,
      expiresAt: now + 24 * 3600_000,
      active: true,
      push: false,
    };
    this.alerts = [rec, ...this.alerts].slice(0, 20);
    writePref('mock_alerts', this.alerts);
    return rec;
  }

  async deleteAlert(id: string) {
    this.alerts = this.alerts.filter((a) => a.id !== id);
    writePref('mock_alerts', this.alerts);
  }

  async entitlements(): Promise<EntitlementResponse> {
    const cfg = await this.config();
    const sub = readPref<{ plan: string; end: number; cancel: boolean } | null>('mock_sub', null);
    const pro = !!sub && sub.end > Date.now();
    return {
      launchMode: cfg.launchMode,
      signedIn: readPref('mock_signed_in', false),
      pro,
      plan: sub?.plan,
      status: sub ? (sub.cancel ? 'cancelled' : 'active') : undefined,
      currentPeriodEnd: sub?.end,
      cancelAtPeriodEnd: sub?.cancel,
      features: allFeatureAccess({ launchMode: cfg.launchMode, entitlement: { pro } }),
    };
  }

  async startCheckout(planId: string): Promise<CheckoutStart> {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new ApiError(400, 'bad_plan', 'Unknown plan');
    return { provider: 'mock', subscriptionId: `sub_mock_${Date.now()}`, keyId: 'rzp_test_mock', planId, name: 'SkyView 3D', description: plan.name };
  }

  async confirmCheckout(payload: Record<string, string>): Promise<EntitlementResponse> {
    const plan = PLANS.find((p) => p.id === payload.planId) ?? PLANS[0];
    const days = plan.period === 'yearly' ? 365 : 30;
    writePref('mock_sub', { plan: plan.id, end: Date.now() + days * 86_400_000, cancel: false });
    return this.entitlements();
  }

  async cancelSubscription(): Promise<EntitlementResponse> {
    const sub = readPref<{ plan: string; end: number; cancel: boolean } | null>('mock_sub', null);
    if (sub) writePref('mock_sub', { ...sub, cancel: true });
    return this.entitlements();
  }

  async sendUsage(_events: UsageEvent[]) {}
}
