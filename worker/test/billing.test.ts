import { describe, expect, it } from 'vitest';
import { RazorpayProvider } from '../src/billing/razorpay';
import { MemorySubscriptionStore } from '../src/billing/store';
import { applyWebhook } from '../src/billing/service';
import { grantsAccess } from '../src/billing/types';
import { hmacSha256Hex } from '../src/billing/hmac';

const cfg = { keyId: 'rzp_test_abc', keySecret: 'test_secret', webhookSecret: 'whsec', planIds: { pro_monthly: 'plan_M', pro_yearly: 'plan_Y' } };

function fakeRazorpay() {
  const calls: { url: string; body?: unknown }[] = [];
  const subs: Record<string, Record<string, unknown>> = {};
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('rzp_test_abc:test_secret')}`);
    if (url.endsWith('/subscriptions') && init?.method === 'POST') {
      const s = { id: 'sub_1', plan_id: body.plan_id, status: 'created', notes: body.notes, current_end: null };
      subs.sub_1 = s;
      return Response.json(s);
    }
    const m = /\/subscriptions\/(sub_\w+)(\/cancel)?$/.exec(url);
    if (m) {
      const s = subs[m[1]] ?? { id: m[1], plan_id: 'plan_M', status: 'active', notes: { user_id: 'u1', plan: 'pro_monthly' }, current_end: 1_900_000_000 };
      if (m[2]) s.status = 'active'; // cancel_at_cycle_end keeps it active until the cycle ends
      return Response.json(s);
    }
    return new Response('{}', { status: 404 });
  };
  return { calls, subs, fetchImpl };
}

describe('Razorpay provider (test mode)', () => {
  it('refuses live keys unless explicitly acknowledged', () => {
    expect(() => new RazorpayProvider({ ...cfg, keyId: 'rzp_live_xyz' })).toThrow(/TEST keys/);
    expect(() => new RazorpayProvider({ ...cfg, keyId: 'rzp_live_xyz', allowLive: true })).not.toThrow();
  });

  it('creates a subscription with the user id in notes', async () => {
    const f = fakeRazorpay();
    const p = new RazorpayProvider(cfg, f.fetchImpl);
    const out = await p.createCheckout({ planId: 'pro_yearly', user: { id: 'u1', email: 'a@b.c' } });
    expect(out).toMatchObject({ provider: 'razorpay', subscriptionId: 'sub_1', keyId: 'rzp_test_abc', prefill: { email: 'a@b.c' } });
    expect(f.calls[0].body).toMatchObject({ plan_id: 'plan_Y', total_count: 10, notes: { user_id: 'u1', plan: 'pro_yearly' } });
    expect(out.subscription).toMatchObject({ userId: 'u1', planId: 'pro_yearly', status: 'created' });
  });

  it('verifies the checkout handler signature (payment_id|subscription_id)', async () => {
    const p = new RazorpayProvider(cfg, fakeRazorpay().fetchImpl);
    const sig = await hmacSha256Hex('test_secret', 'pay_1|sub_1');
    expect(await p.verifyCheckout({ razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_1', razorpay_signature: sig })).toBe('sub_1');
    expect(await p.verifyCheckout({ razorpay_payment_id: 'pay_2', razorpay_subscription_id: 'sub_1', razorpay_signature: sig })).toBeUndefined();
  });

  it('verifies webhook signatures and applies events idempotently', async () => {
    const f = fakeRazorpay();
    const p = new RazorpayProvider(cfg, f.fetchImpl);
    const store = new MemorySubscriptionStore();
    const body = JSON.stringify({
      event: 'subscription.activated',
      created_at: 1,
      payload: { subscription: { entity: { id: 'sub_9', plan_id: 'plan_M', status: 'active', current_end: 1_900_000_000, notes: { user_id: 'u7', plan: 'pro_monthly' } } } },
    });
    const good = new Headers({ 'x-razorpay-signature': await hmacSha256Hex('whsec', body), 'x-razorpay-event-id': 'evt_1' });
    const bad = new Headers({ 'x-razorpay-signature': 'deadbeef', 'x-razorpay-event-id': 'evt_1' });
    expect(await p.parseWebhook(body, bad)).toBeUndefined();
    const ev = (await p.parseWebhook(body, good))!;
    expect(await applyWebhook(store, p, ev)).toBe('applied');
    expect(await applyWebhook(store, p, ev)).toBe('duplicate');
    const s = await store.latestForUser('u7');
    expect(s).toMatchObject({ id: 'sub_9', status: 'active', planId: 'pro_monthly', currentPeriodEnd: 1_900_000_000_000 });
    expect(grantsAccess(s!)).toBe(true);
  });

  it('later webhooks without notes keep the known user', async () => {
    const p = new RazorpayProvider(cfg, fakeRazorpay().fetchImpl);
    const store = new MemorySubscriptionStore();
    await store.upsert({ id: 'sub_5', provider: 'razorpay', userId: 'u5', planId: 'pro_monthly', status: 'active', cancelAtPeriodEnd: false });
    await applyWebhook(store, p, { id: 'e2', type: 'subscription.halted', subscription: { id: 'sub_5', provider: 'razorpay', status: 'halted', cancelAtPeriodEnd: false, currentPeriodEnd: 1 } });
    const s = await store.latestForUser('u5');
    expect(s?.status).toBe('halted');
    expect(grantsAccess(s!)).toBe(false);
  });
});

describe('access rules', () => {
  const now = 1_800_000_000_000;
  it('active/authenticated/pending grant Pro; cancelled keeps it until period end', () => {
    expect(grantsAccess({ status: 'active' }, now)).toBe(true);
    expect(grantsAccess({ status: 'authenticated' }, now)).toBe(true);
    expect(grantsAccess({ status: 'pending' }, now)).toBe(true);
    expect(grantsAccess({ status: 'halted' }, now)).toBe(false);
    expect(grantsAccess({ status: 'cancelled', currentPeriodEnd: now + 1000 }, now)).toBe(true);
    expect(grantsAccess({ status: 'cancelled', currentPeriodEnd: now - 1000 }, now)).toBe(false);
    expect(grantsAccess({ status: 'created' }, now)).toBe(false);
  });
});
