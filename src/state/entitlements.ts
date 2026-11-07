import { computed, signal } from '@preact/signals';
import { canUse, FEATURES, maxFollowedFlights, tierOf, type FeatureContext, type FeatureId, type LaunchMode, type Tier } from '../config/features';
import { env } from '../config/env';
import type { AppConfig, EntitlementResponse } from '../../shared/api';

/**
 * Client-side entitlement state. The Worker's /api/config (LAUNCH_MODE, tier overrides) and /api/me/entitlements
 * (subscription) are the source of truth; until they answer we use the build-time VITE_LAUNCH_MODE.
 * UI code must use canUseFeature() / useFeature() — never compare tiers itself.
 */
export const appConfig = signal<AppConfig | null>(null);
export const launchMode = signal<LaunchMode>(env.launchMode);
export const tierOverrides = signal<Partial<Record<FeatureId, Tier>>>({});
export const entitlement = signal<EntitlementResponse | null>(null);
export const isPro = computed(() => !!entitlement.value?.pro);

export const featureContext = computed<FeatureContext>(() => ({
  launchMode: launchMode.value,
  entitlement: { pro: isPro.value },
  tierOverrides: tierOverrides.value,
}));

export function canUseFeature(id: FeatureId): boolean {
  return canUse(id, featureContext.value);
}

/** Upsell request: set by useFeature().request() when a locked feature is tapped; the UpsellSheet renders it. */
export const upsellFor = signal<FeatureId | null>(null);
/** Usage hook for analytics, installed by src/lib/analytics.ts. */
export const featureUsage = { track: (_id: FeatureId, _event: 'use' | 'locked' | 'view' | 'upsell_click') => {} };

export interface FeatureHandle {
  allowed: boolean;
  tier: Tier;
  label: string;
  /** Run `action` if allowed, otherwise open the upsell sheet. Always records usage for analytics. */
  run: (action: () => void) => void;
}

/** Preact-friendly accessor (reads signals, so components re-render when entitlements change). */
export function useFeature(id: FeatureId): FeatureHandle {
  const allowed = canUseFeature(id);
  return {
    allowed,
    tier: tierOf(id, tierOverrides.value),
    label: FEATURES[id].label,
    run: (action) => {
      if (canUseFeature(id)) {
        featureUsage.track(id, 'use');
        action();
      } else {
        featureUsage.track(id, 'locked');
        upsellFor.value = id;
      }
    },
  };
}

export const maxPinned = computed(() => maxFollowedFlights(featureContext.value));
