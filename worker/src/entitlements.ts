import type { Ctx } from './context';
import type { AuthUser } from './auth';
import type { EntitlementResponse } from '../../shared/api';
import { allFeatureAccess, canUse, parseLaunchMode, parseTierOverrides, type FeatureId } from '../../src/config/features';
import { HttpError } from './lib/http';

/** Subscription lookup; implemented against Supabase in M7. */
export interface SubscriptionInfo {
  plan?: string;
  status?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  active: boolean;
}

export type SubscriptionLookup = (ctx: Ctx, user: AuthUser) => Promise<SubscriptionInfo | undefined>;
let lookup: SubscriptionLookup = async () => undefined;
export function setSubscriptionLookup(fn: SubscriptionLookup) {
  lookup = fn;
}

/** Server-side entitlement: LAUNCH_MODE + tier overrides + the user's subscription. */
export async function entitlementFor(ctx: Ctx, user: AuthUser | undefined): Promise<EntitlementResponse> {
  const launchMode = parseLaunchMode(ctx.env.LAUNCH_MODE);
  const tierOverrides = parseTierOverrides(ctx.env.FEATURE_TIERS);
  // Looked up in open mode too, so the account screen can show the plan.
  const sub = user ? await lookup(ctx, user).catch(() => undefined) : undefined;
  const pro = !!sub?.active;
  return {
    launchMode,
    signedIn: !!user,
    pro,
    plan: sub?.plan,
    status: sub?.status,
    currentPeriodEnd: sub?.currentPeriodEnd,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd,
    features: allFeatureAccess({ launchMode, entitlement: { pro }, tierOverrides }),
  };
}

/** Throw 402 if the feature is locked for this request. */
export async function requireFeature(ctx: Ctx, user: AuthUser | undefined, id: FeatureId): Promise<void> {
  const launchMode = parseLaunchMode(ctx.env.LAUNCH_MODE);
  if (launchMode === 'open') return;
  const ent = await entitlementFor(ctx, user);
  if (!canUse(id, { launchMode, entitlement: { pro: ent.pro }, tierOverrides: parseTierOverrides(ctx.env.FEATURE_TIERS) })) {
    throw new HttpError(402, 'pro_required', `${id} requires SkyView Pro`);
  }
}
