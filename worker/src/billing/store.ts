import type { NormalizedSubscription } from './types';

/** Where subscription state lives. Supabase Postgres in production (service-role key, server-side only). */
export interface SubscriptionStore {
  latestForUser(userId: string): Promise<NormalizedSubscription | undefined>;
  get(id: string): Promise<NormalizedSubscription | undefined>;
  upsert(s: NormalizedSubscription): Promise<void>;
  /** Idempotency: returns false if this webhook event id was already processed. */
  markEvent(id: string, payload: unknown): Promise<boolean>;
}

interface Row {
  id: string;
  provider: string;
  user_id: string | null;
  plan_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function fromRow(r: Row): NormalizedSubscription {
  return {
    id: r.id,
    provider: r.provider as NormalizedSubscription['provider'],
    userId: r.user_id ?? undefined,
    planId: (r.plan_id ?? undefined) as NormalizedSubscription['planId'],
    status: r.status,
    currentPeriodEnd: r.current_period_end ? Date.parse(r.current_period_end) : undefined,
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
  };
}

/** Supabase PostgREST client for the `subscriptions` and `billing_events` tables (see supabase/migrations). */
export class SupabaseSubscriptionStore implements SubscriptionStore {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly fetchImpl: (u: string, i?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, 'Content-Type': 'application/json', ...extra };
  }

  async latestForUser(userId: string) {
    const r = await this.fetchImpl(
      `${this.url}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=1`,
      { headers: this.headers() },
    );
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    const rows = (await r.json()) as Row[];
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async get(id: string) {
    const r = await this.fetchImpl(`${this.url}/rest/v1/subscriptions?id=eq.${encodeURIComponent(id)}&select=*`, { headers: this.headers() });
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    const rows = (await r.json()) as Row[];
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async upsert(s: NormalizedSubscription) {
    const body = {
      id: s.id,
      provider: s.provider,
      user_id: s.userId ?? null,
      plan_id: s.planId ?? null,
      status: s.status,
      current_period_end: s.currentPeriodEnd ? new Date(s.currentPeriodEnd).toISOString() : null,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      raw: s.raw ?? null,
      updated_at: new Date().toISOString(),
    };
    // Never let a webhook without notes wipe a known user id.
    if (!s.userId) delete (body as Partial<typeof body>).user_id;
    const r = await this.fetchImpl(`${this.url}/rest/v1/subscriptions?on_conflict=id`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`supabase upsert ${r.status}: ${await r.text()}`);
  }

  async markEvent(id: string, payload: unknown) {
    const r = await this.fetchImpl(`${this.url}/rest/v1/billing_events`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ id, payload }),
    });
    if (r.status === 409) return false;
    if (!r.ok) throw new Error(`supabase event ${r.status}`);
    return true;
  }
}

export class MemorySubscriptionStore implements SubscriptionStore {
  readonly subs = new Map<string, NormalizedSubscription>();
  readonly events = new Set<string>();
  async latestForUser(userId: string) {
    return [...this.subs.values()].reverse().find((s) => s.userId === userId);
  }
  async get(id: string) {
    return this.subs.get(id);
  }
  async upsert(s: NormalizedSubscription) {
    const prev = this.subs.get(s.id);
    this.subs.delete(s.id);
    this.subs.set(s.id, { ...prev, ...s, userId: s.userId ?? prev?.userId });
  }
  async markEvent(id: string) {
    if (this.events.has(id)) return false;
    this.events.add(id);
    return true;
  }
}
