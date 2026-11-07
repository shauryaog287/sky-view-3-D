import { describe, expect, it } from 'vitest';
import { FlightService } from '../src/flights/flightService';
import { ProviderError, type ProviderAdapter, type ProviderQuery } from '../src/providers/types';
import { TrackRecorder } from '../src/flights/trackRecorder';
import type { AircraftState, ProviderId, TrackPoint } from '../../shared/types';

const DEL_VIEW = { minLat: 28.3, maxLat: 28.8, minLon: 76.9, maxLon: 77.4 };

function ac(hex: string, o: Partial<AircraftState> = {}): AircraftState {
  return { hex, lat: 28.55, lon: 77.1, onGround: false, posTs: 0, seenTs: 0, source: 'adsblol', track: 90, gs: 300, ...o };
}

class FakeProvider implements ProviderAdapter {
  calls: ProviderQuery[] = [];
  readonly label: string;
  readonly commercialUseAllowed = false;
  readonly attribution = 'test';
  constructor(
    readonly id: ProviderId,
    private readonly respond: (q: ProviderQuery) => AircraftState[] | Promise<AircraftState[]>,
    readonly limits = { capacity: 10, refillPerSec: 10 },
  ) {
    this.label = id;
  }
  supports(kind: ProviderQuery['kind']) {
    return kind !== 'bbox';
  }
  cost() {
    return 1;
  }
  async fetch(q: ProviderQuery) {
    this.calls.push(q);
    return this.respond(q);
  }
}

function setup(providers: ProviderAdapter[], extra: Partial<ConstructorParameters<typeof FlightService>[0]> = {}) {
  const clock = { t: 1_000_000 };
  const svc = new FlightService({
    providers,
    now: () => clock.t,
    cacheTtlMs: 3000,
    maxWaitMs: 1500,
    // Yield to the event loop without moving the fake clock (inflight refreshes win the race).
    sleep: () => new Promise((r) => setTimeout(r, 0)),
    ...extra,
  });
  return { svc, clock };
}

describe('FlightService', () => {
  it('shares one upstream call between concurrent viewers and caches for the TTL', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = new FakeProvider('adsblol', async () => {
      await gate;
      return [ac('aaaaaa', { posTs: 1_000_000 })];
    });
    const { svc, clock } = setup([p]);
    const r1 = svc.region(DEL_VIEW);
    const r2 = svc.region(DEL_VIEW);
    release();
    const [a, b] = await Promise.all([r1, r2]);
    expect(a.aircraft).toHaveLength(1);
    expect(b.aircraft).toHaveLength(1);
    const callsAfterFirst = p.calls.length;
    expect(callsAfterFirst).toBe(a.buckets.length); // one call per bucket, not per viewer
    clock.t += 1000;
    await svc.region(DEL_VIEW);
    expect(p.calls.length).toBe(callsAfterFirst); // served from cache
    clock.t += 3000;
    await svc.region(DEL_VIEW);
    expect(p.calls.length).toBe(callsAfterFirst * 2); // refreshed after TTL
  });

  it('merges providers by hex with freshest position winning', async () => {
    const a = new FakeProvider('adsblol', () => [ac('aaaaaa', { posTs: 999_000, lat: 28.5 }), ac('bbbbbb', { posTs: 999_000 })]);
    const b = new FakeProvider('airplaneslive', () => [ac('aaaaaa', { posTs: 999_500, lat: 28.6, source: 'airplaneslive' })]);
    const { svc } = setup([a, b]);
    const r = await svc.region(DEL_VIEW);
    const merged = r.aircraft.find((x) => x.hex === 'aaaaaa')!;
    expect(merged.lat).toBe(28.6);
    expect(merged.source).toBe('airplaneslive');
    expect(r.aircraft).toHaveLength(2);
  });

  it('backs off a provider after 429 and fails over to the next one', async () => {
    const limited = new FakeProvider('adsblol', () => {
      throw new ProviderError('rate limited', 429, 10_000);
    });
    const backup = new FakeProvider('airplaneslive', () => [ac('cccccc', { posTs: 1_000_000 })]);
    const { svc, clock } = setup([limited, backup]);
    const r = await svc.region(DEL_VIEW);
    expect(r.aircraft.map((x) => x.hex)).toEqual(['cccccc']);
    const status = svc.providerStatus().find((s) => s.id === 'adsblol')!;
    expect(status.ok).toBe(false);
    expect(status.blockedUntil).toBeGreaterThan(clock.t);
    const before = limited.calls.length;
    clock.t += 5000;
    await svc.region(DEL_VIEW);
    expect(limited.calls.length).toBe(before); // still backed off
    clock.t += 6000;
    await svc.region(DEL_VIEW);
    expect(limited.calls.length).toBeGreaterThan(before);
  });

  it('serves stale data (flagged) when no provider token is available', async () => {
    const p = new FakeProvider('adsblol', () => [ac('dddddd', { posTs: 1_000_000 })], { capacity: 1, refillPerSec: 0.01 });
    const { svc, clock } = setup([p]);
    const first = await svc.region({ minLat: 28.5, maxLat: 28.6, minLon: 77.0, maxLon: 77.2 });
    expect(first.aircraft).toHaveLength(1);
    clock.t += 20_000;
    const second = await svc.region({ minLat: 28.5, maxLat: 28.6, minLon: 77.0, maxLon: 77.2 });
    expect(second.aircraft).toHaveLength(1);
    expect(second.stale).toBe(true);
    expect(p.calls.length).toBe(1);
  });

  it('reports providers_down when every provider is backed off', async () => {
    const p = new FakeProvider('adsblol', () => {
      throw new ProviderError('HTTP 503', 503);
    });
    const { svc } = setup([p]);
    const r = await svc.region(DEL_VIEW);
    expect(r.aircraft).toEqual([]);
    expect(r.notice).toBe('providers_down');
  });

  it('flags zoomed-out views as truncated', async () => {
    const p = new FakeProvider('adsblol', () => []);
    const { svc } = setup([p]);
    const r = await svc.region({ minLat: -60, maxLat: 60, minLon: -170, maxLon: 170 });
    expect(r.truncated).toBe(true);
    expect(r.notice).toBe('zoom_in');
    expect(p.calls.length).toBeLessThanOrEqual(12);
  });

  it('searches flight numbers through callsign normalisation', async () => {
    const p = new FakeProvider('adsblol', (q) =>
      q.kind === 'callsign' && q.callsign === 'IGO2134' ? [ac('eeeeee', { callsign: 'IGO2134', posTs: 1_000_000 })] : [],
    );
    const { svc } = setup([p]);
    const r = await svc.search('6E-2134');
    expect(r.candidates[0]).toBe('IGO2134');
    expect(r.aircraft[0]?.hex).toBe('eeeeee');
  });

  it('records sparse track points for replay', async () => {
    const written: TrackPoint[] = [];
    const recorder = new TrackRecorder({ write: async (p) => void written.push(...p) }, { minIntervalMs: 15_000 });
    let t = 1_000_000;
    const p = new FakeProvider('adsblol', () => [ac('ffffff', { posTs: t, lat: 28.5 + (t - 1_000_000) / 1e8 })]);
    const { svc, clock } = setup([p], { recorder });
    for (let i = 0; i < 10; i++) {
      await svc.region(DEL_VIEW);
      clock.t += 4000;
      t = clock.t;
    }
    await recorder.flush();
    // 40 s of polling at 4 s → points every ≥15 s: 3 points.
    expect(written.length).toBe(3);
    expect(written[0]).toMatchObject({ hex: 'ffffff' });
  });
});
