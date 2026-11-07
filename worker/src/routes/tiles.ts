import type { Router } from '../lib/http';
import { json } from '../lib/http';
import type { Ctx } from '../context';
import type { TilesSessionResponse } from '../../../shared/api';
import { intVar } from '../env';
import { tilesMode } from './config';
import { D1CounterStore, MemoryCounterStore, sha256Hex, utcDay, type CounterStore } from '../lib/counters';
import { checkTilesSession } from '../tiles';
import { resolveUser } from '../auth';
import { entitlementFor } from '../entitlements';

const memoryCounters = new MemoryCounterStore();

export function registerTilesRoutes(r: Router<Ctx>) {
  r.on('POST', '/api/tiles/session', async (req, ctx) => {
    const env = ctx.env;
    const mode = tilesMode(env);
    const ionToken = env.CESIUM_ION_TOKEN || undefined;
    if (mode === 'off') {
      return json({ allowed: false, mode, ionToken, reason: 'Photorealistic tiles are not configured' } satisfies TilesSessionResponse);
    }
    // Photoreal airport views are a Pro feature in freemium mode; the cheaper layer is used otherwise.
    const user = await resolveUser(ctx);
    const ent = await entitlementFor(ctx, user);
    if (!ent.features.airport_views) {
      return json({ allowed: false, mode, ionToken, reason: 'Photorealistic 3D is a Pro feature' } satisfies TilesSessionResponse);
    }
    const store: CounterStore = env.DB ? new D1CounterStore(env.DB) : memoryCounters;
    const ip = req.headers.get('CF-Connecting-IP') ?? '';
    const day = utcDay();
    const subject = user ? `user:${user.id}` : ctx.deviceId ? `device:${ctx.deviceId}` : `ip:${await sha256Hex(`${ip}|${day}`)}`;
    const perSubject = intVar(env.TILES_SESSIONS_PER_USER_DAY, 20);
    const res = await checkTilesSession(
      store,
      { perSubjectPerDay: perSubject, perIpPerDay: perSubject * 3, globalPerDay: intVar(env.TILES_SESSIONS_GLOBAL_DAY, 3000) },
      { subject, ipHash: ip ? (await sha256Hex(`${ip}|${day}`)).slice(0, 24) : undefined },
      day,
    );
    const body: TilesSessionResponse = {
      allowed: res.allowed,
      mode,
      ionToken,
      usedToday: res.usedToday,
      limitToday: res.limitToday,
      reason: res.allowed ? undefined : res.reason === 'global_cap' ? 'Daily photorealistic budget reached' : 'Daily photorealistic limit reached',
      googleKey: res.allowed && mode === 'google' ? env.GOOGLE_MAPS_API_KEY : undefined,
    };
    return json(body);
  });
}
