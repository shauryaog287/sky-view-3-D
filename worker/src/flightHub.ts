import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { intVar } from './env';
import { FlightService } from './flights/flightService';
import { TrackRecorder } from './flights/trackRecorder';
import { D1TrackSink } from './flights/d1TrackSink';
import { createProviders } from './providers';
import { errorResponse, json, parseBBoxParam, HttpError } from './lib/http';

/**
 * Singleton Durable Object that owns every upstream flight-data call.
 * Being a single instance is what makes the token buckets and the shared bucket cache global.
 */
export class FlightHub extends DurableObject<Env> {
  private readonly service: FlightService;
  private readonly recorder?: TrackRecorder;
  private readonly skipped: string[];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const { active, skipped } = createProviders(env);
    this.skipped = skipped;
    if (env.DB) {
      this.recorder = new TrackRecorder(new D1TrackSink(env.DB), {
        minIntervalMs: intVar(env.TRACK_MIN_INTERVAL_S, 15) * 1000,
      });
    }
    this.service = new FlightService({
      providers: active,
      cacheTtlMs: intVar(env.CACHE_TTL_MS, 3000),
      recorder: this.recorder,
      log: (m) => console.log(m),
    });
  }

  override async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      switch (url.pathname) {
        case '/aircraft': {
          const r = await this.service.region(parseBBoxParam(url.searchParams.get('bbox')));
          await this.scheduleFlush();
          return json(r);
        }
        case '/search': {
          const q = (url.searchParams.get('q') ?? '').slice(0, 32);
          if (q.trim().length < 2) throw new HttpError(400, 'bad_query', 'Type at least 2 characters');
          return json(await this.service.search(q));
        }
        case '/lookup': {
          const a = await this.service.lookup({
            hex: url.searchParams.get('hex') ?? undefined,
            callsign: url.searchParams.get('callsign') ?? undefined,
          });
          return json({ aircraft: a ?? null });
        }
        case '/status':
          return json({
            providers: this.service.providerStatus(),
            skipped: this.skipped,
            cachedBuckets: this.service.cachedBuckets,
            pendingTrackPoints: this.recorder?.pending ?? 0,
          });
        default:
          return json({ error: 'not_found' }, { status: 404 });
      }
    } catch (e) {
      return errorResponse(e);
    }
  }

  private async scheduleFlush() {
    if (!this.recorder) return;
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  override async alarm(): Promise<void> {
    await this.recorder?.flush();
    this.recorder?.prune(Date.now());
    this.service.prune();
  }
}
