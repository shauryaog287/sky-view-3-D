import type { AuthUser } from '../auth';
import type { CheckoutStart } from '../../../shared/apiTypes';
import type { PlanId } from '../../../src/config/plans';

/** Provider-neutral subscription record (stored in Supabase `subscriptions`). */
export interface NormalizedSubscription {
  id: string; // provider subscription id, e.g. sub_...
  provider: 'razorpay' | 'stripe' | 'mock';
  userId?: string;
  planId?: PlanId;
  /** created | authenticated | active | pending | halted | cancelled | completed | expired | paused */
  status: string;
  /** Epoch ms when the current paid period ends. */
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  raw?: unknown;
}

export interface WebhookEvent {
  id: string;
  type: string;
  subscription?: NormalizedSubscription;
}

/**
 * Payment provider abstraction. Razorpay (India, UPI autopay) is implemented; Stripe can be added later by
 * implementing this interface — routes and entitlements do not change.
 */
export interface PaymentProvider {
  readonly id: 'razorpay' | 'stripe';
  createCheckout(input: { planId: PlanId; user: AuthUser }): Promise<CheckoutStart & { subscription: NormalizedSubscription }>;
  /** Verify the client-side checkout callback; returns the subscription id if the signature is valid. */
  verifyCheckout(payload: Record<string, string>): Promise<string | undefined>;
  /** Verify and parse a webhook delivery. Returns undefined if the signature is invalid. */
  parseWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent | undefined>;
  fetchSubscription(id: string): Promise<NormalizedSubscription>;
  cancel(id: string, atPeriodEnd: boolean): Promise<NormalizedSubscription>;
}

/** Statuses that grant Pro. `pending` = renewal payment failed and is being retried (grace period). */
export function grantsAccess(s: Pick<NormalizedSubscription, 'status' | 'currentPeriodEnd'>, now = Date.now()): boolean {
  if (s.status === 'active' || s.status === 'authenticated' || s.status === 'pending') return true;
  // Cancelled at period end keeps access until the paid period runs out.
  if ((s.status === 'cancelled' || s.status === 'completed') && s.currentPeriodEnd && s.currentPeriodEnd > now) return true;
  return false;
}
