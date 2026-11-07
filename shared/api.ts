import type { FeatureId, LaunchMode, Tier } from '../src/config/features';
import type { PlanDef } from '../src/config/plans';
import type { ProviderId } from './types';

/** GET /api/config — public runtime configuration. The Worker is the source of truth for LAUNCH_MODE. */
export interface AppConfig {
  version: string;
  launchMode: LaunchMode;
  tierOverrides: Partial<Record<FeatureId, Tier>>;
  plans: PlanDef[];
  payments: { enabled: boolean; provider: 'razorpay' | 'none'; testMode: boolean };
  auth: { enabled: boolean };
  tiles: { mode: 'google' | 'ion' | 'off' };
  vapidPublicKey?: string;
  providers: { id: ProviderId; label: string; attribution: string; commercialUseAllowed: boolean }[];
}

/** POST /api/tiles/session — one call per viewing session before creating the Google tileset. */
export interface TilesSessionResponse {
  allowed: boolean;
  mode: 'google' | 'ion' | 'off';
  googleKey?: string;
  reason?: string;
  usedToday?: number;
  limitToday?: number;
}

export interface EntitlementResponse {
  launchMode: LaunchMode;
  signedIn: boolean;
  pro: boolean;
  plan?: string;
  status?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  features: Record<FeatureId, boolean>;
}
