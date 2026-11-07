import type { Router } from '../lib/http';
import { json } from '../lib/http';
import type { Ctx } from '../context';
import type { AppConfig } from '../../../shared/api';
import { parseLaunchMode, parseTierOverrides } from '../../../src/config/features';
import { PLANS } from '../../../src/config/plans';
import { createProviders } from '../providers';
import type { Env } from '../env';

export const API_VERSION = '0.1.0';

export function tilesMode(env: Env): AppConfig['tiles']['mode'] {
  const m = env.TILES_MODE;
  if (m === 'off' || m === 'ion' || m === 'google') return m;
  return env.GOOGLE_MAPS_API_KEY ? 'google' : env.CESIUM_ION_TOKEN ? 'ion' : 'off';
}

export function paymentsEnabled(env: Env): boolean {
  return env.PAYMENTS_ENABLED === 'true' && !!env.RAZORPAY_KEY_ID && !!env.RAZORPAY_KEY_SECRET;
}

export function buildConfig(env: Env): AppConfig {
  const { active } = createProviders(env);
  return {
    version: API_VERSION,
    launchMode: parseLaunchMode(env.LAUNCH_MODE),
    tierOverrides: parseTierOverrides(env.FEATURE_TIERS),
    plans: PLANS,
    payments: {
      enabled: paymentsEnabled(env),
      provider: env.RAZORPAY_KEY_ID ? 'razorpay' : 'none',
      testMode: !env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID.startsWith('rzp_test_'),
    },
    auth: { enabled: !!env.SUPABASE_URL },
    tiles: { mode: tilesMode(env) },
    vapidPublicKey: env.VAPID_PUBLIC_KEY || undefined,
    providers: active.map((p) => ({ id: p.id, label: p.label, attribution: p.attribution, commercialUseAllowed: p.commercialUseAllowed })),
  };
}

export function registerConfigRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/health', () => json({ ok: true, version: API_VERSION }));
  r.on('GET', '/api/config', (_req, ctx) => json(buildConfig(ctx.env), { cacheSeconds: 60 }));
}
