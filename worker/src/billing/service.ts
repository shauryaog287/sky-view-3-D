import type { Env } from '../env';
import { paymentsEnabled } from '../routes/config';
import { RazorpayProvider } from './razorpay';
import { MemorySubscriptionStore, SupabaseSubscriptionStore, type SubscriptionStore } from './store';
import { grantsAccess, type PaymentProvider, type WebhookEvent } from './types';
import type { PlanId } from '../../../src/config/plans';

const devStore = new MemorySubscriptionStore();

export function subscriptionStore(env: Env): SubscriptionStore {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return new SupabaseSubscriptionStore(env.SUPABASE_URL.replace(/\/$/, ''), env.SUPABASE_SERVICE_ROLE_KEY);
  return devStore; // local development only: forgets everything on restart
}

export function paymentProvider(env: Env): PaymentProvider | undefined {
  if (!paymentsEnabled(env)) return undefined;
  return new RazorpayProvider({
    keyId: env.RAZORPAY_KEY_ID!,
    keySecret: env.RAZORPAY_KEY_SECRET!,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    planIds: { pro_monthly: env.RAZORPAY_PLAN_MONTHLY || undefined, pro_yearly: env.RAZORPAY_PLAN_YEARLY || undefined } as Partial<Record<PlanId, string>>,
    allowLive: env.PAYMENTS_LIVE_ACK === 'I_UNDERSTAND_THIS_CHARGES_REAL_MONEY',
  });
}

/**
 * Apply a verified webhook event. Idempotent (event ids recorded); subscription events upsert the stored status.
 * Handles: subscription.authenticated / activated / charged / pending / halted / cancelled / completed / paused / resumed.
 */
export async function applyWebhook(store: SubscriptionStore, provider: PaymentProvider, ev: WebhookEvent): Promise<'applied' | 'duplicate' | 'ignored'> {
  if (!ev.subscription) return 'ignored';
  if (!(await store.markEvent(ev.id, { type: ev.type, subscription: ev.subscription.id }))) return 'duplicate';
  let sub = ev.subscription;
  // Webhooks can arrive out of order; for anything ambiguous re-read the source of truth.
  if (!sub.currentPeriodEnd && ev.type !== 'subscription.cancelled') sub = await provider.fetchSubscription(sub.id).catch(() => sub);
  const prev = await store.get(sub.id);
  await store.upsert({ ...sub, userId: sub.userId ?? prev?.userId, planId: sub.planId ?? prev?.planId });
  return 'applied';
}

export { grantsAccess };
