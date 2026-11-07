import type { AuthUser } from '../auth';
import { planById, type PlanId } from '../../../src/config/plans';
import { hmacSha256Hex, timingSafeEqual } from './hmac';
import type { NormalizedSubscription, PaymentProvider, WebhookEvent } from './types';
import { HttpError } from '../lib/http';

interface RazorpaySubscriptionEntity {
  id: string;
  plan_id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  notes?: Record<string, string> | [];
  short_url?: string;
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  planIds: Partial<Record<PlanId, string>>;
  /** Must be explicitly acknowledged to use live keys. Never set this during the free launch. */
  allowLive?: boolean;
}

const API = 'https://api.razorpay.com/v1';

/**
 * Razorpay Subscriptions (UPI autopay, cards, e-mandates).
 * Flow: server creates a subscription → browser opens Razorpay Checkout with `subscription_id` → handler posts
 * payment id + signature back for verification → webhooks keep the status in sync (renewals, failures, cancels).
 */
export class RazorpayProvider implements PaymentProvider {
  readonly id = 'razorpay' as const;

  constructor(
    private readonly cfg: RazorpayConfig,
    private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
  ) {
    if (!cfg.keyId.startsWith('rzp_test_') && !cfg.allowLive) {
      throw new HttpError(503, 'live_payments_blocked', 'Only Razorpay TEST keys are allowed (keys must start with rzp_test_).');
    }
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${btoa(`${this.cfg.keyId}:${this.cfg.keySecret}`)}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new HttpError(502, 'payment_provider_error', body.error?.description ?? `Razorpay HTTP ${res.status}`);
    return body;
  }

  normalize(e: RazorpaySubscriptionEntity): NormalizedSubscription {
    const notes = Array.isArray(e.notes) ? {} : (e.notes ?? {});
    const planId = (notes.plan as PlanId | undefined) ?? (Object.entries(this.cfg.planIds).find(([, v]) => v === e.plan_id)?.[0] as PlanId | undefined);
    return {
      id: e.id,
      provider: 'razorpay',
      userId: notes.user_id,
      planId,
      status: e.status,
      currentPeriodEnd: e.current_end ? e.current_end * 1000 : undefined,
      cancelAtPeriodEnd: e.status === 'cancelled' && !!e.current_end && !e.ended_at,
      raw: e,
    };
  }

  async createCheckout({ planId, user }: { planId: PlanId; user: AuthUser }) {
    const plan = planById(planId);
    const rzpPlan = this.cfg.planIds[planId];
    if (!plan || !rzpPlan) throw new HttpError(400, 'bad_plan', 'Unknown or unconfigured plan');
    const sub = await this.call<RazorpaySubscriptionEntity>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: rzpPlan,
        total_count: plan.period === 'yearly' ? 10 : 120,
        quantity: 1,
        customer_notify: 1,
        notes: { user_id: user.id, plan: planId },
      }),
    });
    return {
      provider: 'razorpay' as const,
      subscriptionId: sub.id,
      keyId: this.cfg.keyId,
      planId,
      name: 'SkyView 3D',
      description: plan.name,
      prefill: { email: user.email },
      subscription: this.normalize(sub),
    };
  }

  async verifyCheckout(p: Record<string, string>): Promise<string | undefined> {
    const { razorpay_payment_id: pay, razorpay_subscription_id: sub, razorpay_signature: sig } = p;
    if (!pay || !sub || !sig) return undefined;
    // Razorpay docs: signature = HMAC_SHA256(payment_id + "|" + subscription_id, key_secret)
    const expected = await hmacSha256Hex(this.cfg.keySecret, `${pay}|${sub}`);
    return timingSafeEqual(expected, sig) ? sub : undefined;
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent | undefined> {
    if (!this.cfg.webhookSecret) return undefined;
    const sig = headers.get('x-razorpay-signature') ?? '';
    const expected = await hmacSha256Hex(this.cfg.webhookSecret, rawBody);
    if (!timingSafeEqual(expected, sig)) return undefined;
    const body = JSON.parse(rawBody) as { event: string; created_at?: number; payload?: { subscription?: { entity: RazorpaySubscriptionEntity } } };
    const id = headers.get('x-razorpay-event-id') ?? `${body.event}:${body.payload?.subscription?.entity.id ?? ''}:${body.created_at ?? ''}`;
    const entity = body.payload?.subscription?.entity;
    return { id, type: body.event, subscription: entity ? this.normalize(entity) : undefined };
  }

  async fetchSubscription(id: string) {
    return this.normalize(await this.call<RazorpaySubscriptionEntity>(`/subscriptions/${encodeURIComponent(id)}`));
  }

  async cancel(id: string, atPeriodEnd: boolean) {
    const e = await this.call<RazorpaySubscriptionEntity>(`/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancel_at_cycle_end: atPeriodEnd ? 1 : 0 }),
    });
    const n = this.normalize(e);
    // Razorpay keeps status "active" until the cycle ends when cancel_at_cycle_end=1.
    return { ...n, cancelAtPeriodEnd: atPeriodEnd || n.cancelAtPeriodEnd };
  }
}

/** Placeholder for adding Stripe later (international cards). Implement the same interface. */
export class StripeProviderStub implements PaymentProvider {
  readonly id = 'stripe' as const;
  private fail(): never {
    throw new HttpError(501, 'not_implemented', 'Stripe is not implemented yet');
  }
  async createCheckout(): Promise<never> {
    this.fail();
  }
  async verifyCheckout(): Promise<never> {
    this.fail();
  }
  async parseWebhook(): Promise<never> {
    this.fail();
  }
  async fetchSubscription(): Promise<never> {
    this.fail();
  }
  async cancel(): Promise<never> {
    this.fail();
  }
}
