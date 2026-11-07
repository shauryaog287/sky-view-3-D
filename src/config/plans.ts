/**
 * Subscription plans (display + creation). Prices are in INR paise to avoid float issues.
 * The Razorpay plan ids are environment-specific and live in the Worker vars RAZORPAY_PLAN_MONTHLY / _YEARLY
 * (created with `npm run razorpay:plans` in test mode).
 */
export type PlanId = 'pro_monthly' | 'pro_yearly';

export interface PlanDef {
  id: PlanId;
  name: string;
  period: 'monthly' | 'yearly';
  /** Price in paise (₹1 = 100 paise). */
  amountPaise: number;
  currency: 'INR';
  /** Shown under the price. */
  note: string;
}

export const PLANS: PlanDef[] = [
  { id: 'pro_monthly', name: 'Pro Monthly', period: 'monthly', amountPaise: 149_00, currency: 'INR', note: 'Billed monthly. Cancel anytime.' },
  { id: 'pro_yearly', name: 'Pro Yearly', period: 'yearly', amountPaise: 1_299_00, currency: 'INR', note: 'Billed yearly. Save ~27%.' },
];

export function planById(id: string): PlanDef | undefined {
  return PLANS.find((p) => p.id === id);
}

export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: rupees % 1 ? 2 : 0 })}`;
}
