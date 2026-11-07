import type { Router } from '../lib/http';
import { HttpError, json, readJson } from '../lib/http';
import type { Ctx } from '../context';
import { requireUser, resolveUser } from '../auth';
import { entitlementFor } from '../entitlements';
import { applyWebhook, paymentProvider, subscriptionStore } from '../billing/service';
import { grantsAccess } from '../billing/types';
import { planById, type PlanId } from '../../../src/config/plans';

export function registerBillingRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/me/entitlements', async (_req, ctx) => json(await entitlementFor(ctx, await resolveUser(ctx))));

  r.on('POST', '/api/billing/checkout', async (req, ctx) => {
    const user = await requireUser(ctx);
    const provider = paymentProvider(ctx.env);
    if (!provider) throw new HttpError(503, 'payments_not_configured', 'Subscriptions are not available yet');
    const { planId } = await readJson<{ planId: PlanId }>(req);
    if (!planById(planId)) throw new HttpError(400, 'bad_plan');
    const store = subscriptionStore(ctx.env);
    const existing = await store.latestForUser(user.id);
    if (existing && grantsAccess(existing) && !existing.cancelAtPeriodEnd) throw new HttpError(409, 'already_subscribed', 'You already have an active subscription');
    const out = await provider.createCheckout({ planId, user });
    await store.upsert(out.subscription);
    const { subscription: _s, ...start } = out;
    return json(start);
  });

  r.on('POST', '/api/billing/confirm', async (req, ctx) => {
    const user = await requireUser(ctx);
    const provider = paymentProvider(ctx.env);
    if (!provider) throw new HttpError(503, 'payments_not_configured');
    const body = await readJson<Record<string, string>>(req);
    const subId = await provider.verifyCheckout(body);
    if (!subId) throw new HttpError(400, 'bad_signature', 'Payment verification failed');
    const store = subscriptionStore(ctx.env);
    const known = await store.get(subId);
    if (known?.userId && known.userId !== user.id) throw new HttpError(403, 'not_your_subscription');
    const sub = await provider.fetchSubscription(subId);
    await store.upsert({ ...sub, userId: user.id, planId: sub.planId ?? known?.planId });
    return json(await entitlementFor(ctx, user));
  });

  r.on('POST', '/api/billing/cancel', async (_req, ctx) => {
    const user = await requireUser(ctx);
    const provider = paymentProvider(ctx.env);
    if (!provider) throw new HttpError(503, 'payments_not_configured');
    const store = subscriptionStore(ctx.env);
    const sub = await store.latestForUser(user.id);
    if (!sub || !grantsAccess(sub)) throw new HttpError(404, 'no_subscription');
    const updated = await provider.cancel(sub.id, true);
    await store.upsert({ ...updated, userId: user.id, planId: updated.planId ?? sub.planId });
    return json(await entitlementFor(ctx, user));
  });

  // Razorpay → us. Configure in Razorpay Dashboard → Settings → Webhooks (see NEEDS_FROM_ME).
  r.on('POST', '/api/billing/webhook/razorpay', async (req, ctx) => {
    const provider = paymentProvider(ctx.env);
    if (!provider) return json({ ok: false, reason: 'payments disabled' }, { status: 503 });
    const raw = await req.text();
    const ev = await provider.parseWebhook(raw, req.headers);
    if (!ev) throw new HttpError(400, 'bad_signature');
    const result = await applyWebhook(subscriptionStore(ctx.env), provider, ev);
    return json({ ok: true, result });
  });
}
