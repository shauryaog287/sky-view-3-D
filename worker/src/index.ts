import type { Env } from './env';
import { listVar } from './env';
import type { Ctx } from './context';
import { Router, corsHeaders, errorResponse, json, withHeaders } from './lib/http';
import { registerConfigRoutes } from './routes/config';
import { registerFlightRoutes } from './routes/flights';
import { registerInfoRoutes } from './routes/info';
import { registerTilesRoutes } from './routes/tiles';
import { registerWeatherRoutes } from './routes/weather';
import { registerAlertRoutes } from './routes/alerts';
import { registerTrackRoutes } from './routes/track';
import { registerBillingRoutes } from './routes/billing';
import { registerEventRoutes } from './routes/events';
import { registerAirport3dRoutes } from './routes/airport3d';
import { setSubscriptionLookup } from './entitlements';
import { subscriptionStore, grantsAccess } from './billing/service';
import { runScheduled } from './scheduled';

export { FlightHub } from './flightHub';

const router = new Router<Ctx>();
registerConfigRoutes(router);
registerFlightRoutes(router);
registerInfoRoutes(router);
registerTilesRoutes(router);
registerWeatherRoutes(router);
registerAlertRoutes(router);
registerTrackRoutes(router);
registerBillingRoutes(router);
registerEventRoutes(router);
registerAirport3dRoutes(router);

// Entitlements read the user's latest subscription from Supabase.
setSubscriptionLookup(async (ctx, user) => {
  const s = await subscriptionStore(ctx.env).latestForUser(user.id);
  if (!s) return undefined;
  return { plan: s.planId, status: s.status, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, active: grantsAccess(s) };
});

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'];

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const cors = corsHeaders(origin, listVar(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(req) : json({ error: 'not_found' }, { status: 404 });
    }
    const deviceId = req.headers.get('X-Device-Id')?.slice(0, 64) || undefined;
    const authHeader = req.headers.get('Authorization') ?? undefined;
    try {
      const res = await router.handle(req, { env, exec, url, deviceId, authHeader });
      return withHeaders(res ?? json({ error: 'not_found' }, { status: 404 }), cors);
    } catch (e) {
      return withHeaders(errorResponse(e), cors);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, exec: ExecutionContext): Promise<void> {
    exec.waitUntil(runScheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;
