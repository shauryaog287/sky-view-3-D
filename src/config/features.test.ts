import { describe, expect, it } from 'vitest';
import { allFeatureAccess, canUse, FEATURE_IDS, maxFollowedFlights, parseLaunchMode, parseTierOverrides } from './features';

describe('feature entitlements', () => {
  it('LAUNCH_MODE=open unlocks everything for everyone', () => {
    const ctx = { launchMode: 'open' as const, entitlement: { pro: false } };
    expect(FEATURE_IDS.every((id) => canUse(id, ctx))).toBe(true);
    expect(maxFollowedFlights(ctx)).toBe(4);
  });

  it('freemium: free features for everyone, pro features need a subscription', () => {
    const free = { launchMode: 'freemium' as const, entitlement: { pro: false } };
    const pro = { launchMode: 'freemium' as const, entitlement: { pro: true } };
    for (const id of ['live_globe', 'flight_search', 'info_panel', 'follow_cam', 'quality_standard'] as const) expect(canUse(id, free)).toBe(true);
    for (const id of ['airport_views', 'cockpit_cam', 'tower_cam', 'replay', 'alerts', 'weather_effects', 'quality_high', 'multi_follow', 'no_ads'] as const) {
      expect(canUse(id, free)).toBe(false);
      expect(canUse(id, pro)).toBe(true);
    }
    expect(maxFollowedFlights(free)).toBe(1);
    expect(maxFollowedFlights(pro)).toBe(4);
  });

  it('tier overrides come from config, not components', () => {
    const tierOverrides = parseTierOverrides('{"replay":"free","live_globe":"pro","bogus":"free","alerts":"gold"}');
    expect(tierOverrides).toEqual({ replay: 'free', live_globe: 'pro' });
    const ctx = { launchMode: 'freemium' as const, entitlement: { pro: false }, tierOverrides };
    expect(canUse('replay', ctx)).toBe(true);
    expect(canUse('live_globe', ctx)).toBe(false);
    expect(allFeatureAccess(ctx).alerts).toBe(false);
  });

  it('parses config defensively', () => {
    expect(parseLaunchMode('freemium')).toBe('freemium');
    expect(parseLaunchMode('FREEMIUM')).toBe('open');
    expect(parseLaunchMode(undefined)).toBe('open');
    expect(parseTierOverrides('not json')).toEqual({});
    expect(canUse('nope' as never, { launchMode: 'open', entitlement: { pro: true } })).toBe(false);
  });
});
