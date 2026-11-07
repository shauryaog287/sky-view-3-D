import { describe, expect, it } from 'vitest';
import { entitlementFor, requireFeature, setSubscriptionLookup } from '../src/entitlements';
import type { Ctx } from '../src/context';

const ctx = (vars: Record<string, string>): Ctx => ({ env: vars as never, exec: {} as never, url: new URL('https://x/api') });

describe('server-side entitlements', () => {
  it('open mode: no subscription needed for Pro endpoints', async () => {
    await expect(requireFeature(ctx({ LAUNCH_MODE: 'open' }), undefined, 'replay')).resolves.toBeUndefined();
  });

  it('freemium: 402 without an active subscription, allowed with one', async () => {
    setSubscriptionLookup(async (_c, u) => (u.id === 'pro-user' ? { active: true, status: 'active', plan: 'pro_monthly' } : undefined));
    const c = ctx({ LAUNCH_MODE: 'freemium' });
    await expect(requireFeature(c, undefined, 'replay')).rejects.toMatchObject({ status: 402, code: 'pro_required' });
    await expect(requireFeature(c, { id: 'free-user' }, 'alerts')).rejects.toMatchObject({ status: 402 });
    await expect(requireFeature(c, { id: 'pro-user' }, 'alerts')).resolves.toBeUndefined();
    await expect(requireFeature(c, undefined, 'flight_search')).resolves.toBeUndefined();
    const ent = await entitlementFor(c, { id: 'pro-user' });
    expect(ent).toMatchObject({ launchMode: 'freemium', signedIn: true, pro: true, plan: 'pro_monthly' });
    expect(ent.features.replay).toBe(true);
  });

  it('FEATURE_TIERS overrides apply on the server too', async () => {
    setSubscriptionLookup(async () => undefined);
    const c = ctx({ LAUNCH_MODE: 'freemium', FEATURE_TIERS: '{"replay":"free"}' });
    await expect(requireFeature(c, undefined, 'replay')).resolves.toBeUndefined();
    await expect(requireFeature(c, undefined, 'alerts')).rejects.toMatchObject({ status: 402 });
  });
});
