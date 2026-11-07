/**
 * Feature registry and entitlement rules.
 *
 * This module is PURE (no DOM, no Worker globals) so the same rules run in the browser (to show/hide UI) and in the
 * Worker (to enforce access on paid endpoints such as replay and alerts).
 *
 *  - Every feature has an id and a default tier: "free" | "pro".
 *  - LAUNCH_MODE = "open"      → everything unlocked for everyone (current launch).
 *    LAUNCH_MODE = "freemium"  → "pro" features require an active subscription.
 *  - Tiers can be overridden by config (Worker var FEATURE_TIERS='{"replay":"free"}') without touching components.
 *
 * Components must never check tiers directly: use canUse(id) / useFeature(id) (see src/state/entitlements.ts).
 */
export type Tier = 'free' | 'pro';
export type LaunchMode = 'open' | 'freemium';

export interface FeatureDef {
  tier: Tier;
  label: string;
  /** One-line pitch shown on the upsell sheet. */
  pitch: string;
}

export const FEATURES = {
  // ── Free (proposed future split) ──
  live_globe: { tier: 'free', label: 'Live 3D globe', pitch: 'See live aircraft on a 3D globe.' },
  flight_search: { tier: 'free', label: 'Flight search', pitch: 'Find any flight by number, callsign or registration.' },
  info_panel: { tier: 'free', label: 'Flight details', pitch: 'Altitude, speed, heading, route and aircraft type.' },
  follow_cam: { tier: 'free', label: 'Follow camera', pitch: 'Chase any flight with a smooth follow camera.' },
  quality_standard: { tier: 'free', label: 'Standard quality', pitch: 'Low and medium graphics quality.' },
  // ── Pro (proposed future split) ──
  airport_views: { tier: 'pro', label: 'Airport takeoff & landing views', pitch: 'Watch takeoffs and landings at photorealistic airports.' },
  cockpit_cam: { tier: 'pro', label: 'Cockpit camera', pitch: 'Ride along from the flight deck.' },
  tower_cam: { tier: 'pro', label: 'Tower & runway cameras', pitch: 'Tower view and runway-end view on approach and departure.' },
  replay: { tier: 'pro', label: 'Flight replay', pitch: 'Replay the last 60 minutes of any tracked flight.' },
  alerts: { tier: 'pro', label: 'Flight alerts', pitch: 'Get notified when a flight takes off, starts descending or lands.' },
  weather_effects: { tier: 'pro', label: 'Live weather & sky', pitch: 'Real clouds, visibility and lighting around the aircraft.' },
  quality_high: { tier: 'pro', label: 'High quality mode', pitch: 'Maximum detail, shadows and more 3D aircraft.' },
  multi_follow: { tier: 'pro', label: 'Follow multiple flights', pitch: 'Pin up to 4 flights and switch between them.' },
  no_ads: { tier: 'pro', label: 'No ads', pitch: 'An ad-free experience.' },
} as const satisfies Record<string, FeatureDef>;

export type FeatureId = keyof typeof FEATURES;
export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

export interface Entitlement {
  /** True when the user has an active (or in-grace) paid subscription. */
  pro: boolean;
}

export interface FeatureContext {
  launchMode: LaunchMode;
  entitlement: Entitlement;
  /** Optional per-feature tier overrides from config. */
  tierOverrides?: Partial<Record<FeatureId, Tier>>;
}

export function parseLaunchMode(v: string | undefined | null): LaunchMode {
  return v === 'freemium' ? 'freemium' : 'open';
}

/** Parse FEATURE_TIERS JSON safely; unknown ids and bad values are ignored. */
export function parseTierOverrides(json: string | undefined | null): Partial<Record<FeatureId, Tier>> {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const out: Partial<Record<FeatureId, Tier>> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k in FEATURES && (v === 'free' || v === 'pro')) out[k as FeatureId] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function tierOf(id: FeatureId, overrides?: Partial<Record<FeatureId, Tier>>): Tier {
  return overrides?.[id] ?? FEATURES[id].tier;
}

/** The single source of truth for "may this user use this feature right now?". */
export function canUse(id: FeatureId, ctx: FeatureContext): boolean {
  if (!(id in FEATURES)) return false;
  if (ctx.launchMode === 'open') return true;
  return tierOf(id, ctx.tierOverrides) === 'free' || ctx.entitlement.pro;
}

/** Map of every feature → allowed, e.g. for /api/me/entitlements. */
export function allFeatureAccess(ctx: FeatureContext): Record<FeatureId, boolean> {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, canUse(id, ctx)])) as Record<FeatureId, boolean>;
}

/** Limits that depend on entitlement (not just on/off). */
export function maxFollowedFlights(ctx: FeatureContext): number {
  return canUse('multi_follow', ctx) ? 4 : 1;
}
