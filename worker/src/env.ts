/** Worker bindings and configuration. Vars are set in wrangler.toml; secrets via `wrangler secret put`. */
export interface Env {
  FLIGHT_HUB: DurableObjectNamespace;
  DB?: D1Database;
  ASSETS?: Fetcher;

  // ── Plain vars (wrangler.toml [vars]) ──
  LAUNCH_MODE?: string; // "open" | "freemium"
  FEATURE_TIERS?: string; // JSON overrides: {"replay":"free"}
  PROVIDERS?: string; // e.g. "adsblol,airplaneslive,opensky" | "fixture" | "commercial"
  CACHE_TTL_MS?: string;
  ALLOWED_ORIGINS?: string; // comma separated; "*" for any (dev only)
  TILES_SESSIONS_PER_USER_DAY?: string;
  TILES_SESSIONS_GLOBAL_DAY?: string;
  TILES_MODE?: string; // "google" | "ion" | "off"
  TRACK_RETENTION_MIN?: string;
  TRACK_MIN_INTERVAL_S?: string;
  ENRICHMENT?: string; // "adsbdb" | "off"
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  SUPABASE_URL?: string;
  RAZORPAY_PLAN_MONTHLY?: string;
  RAZORPAY_PLAN_YEARLY?: string;
  RAZORPAY_KEY_ID?: string; // public half; still kept server-side and sent to the client per checkout
  PAYMENTS_ENABLED?: string; // "true" to allow checkout calls at all (test mode)
  /** Live Razorpay keys are refused unless this is exactly I_UNDERSTAND_THIS_CHARGES_REAL_MONEY. */
  PAYMENTS_LIVE_ACK?: string;
  COMMERCIAL_PROVIDER?: string;
  OPENSKY_DAILY_CREDITS?: string;

  // ── Secrets ──
  OPENSKY_CLIENT_ID?: string;
  OPENSKY_CLIENT_SECRET?: string;
  COMMERCIAL_API_KEY?: string;
  GOOGLE_MAPS_API_KEY?: string;
  CESIUM_ION_TOKEN?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_JWT_SECRET?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  VAPID_PRIVATE_KEY?: string;
  ADMIN_TOKEN?: string;
}

export function intVar(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : fallback;
}

export function listVar(v: string | undefined, fallback: string[]): string[] {
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
