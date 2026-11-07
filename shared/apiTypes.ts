/** Request/response shapes for alerts, billing and analytics endpoints. */
export type AlertCondition = 'takeoff' | 'descent' | 'approach' | 'landed';

export interface CreateAlertInput {
  hex?: string;
  callsign?: string;
  /** Human label, e.g. "6E 2134 DEL→BOM". */
  label: string;
  condition: AlertCondition;
  /** Optional ICAO airport filter (e.g. only when descending into VIDP). */
  airport?: string;
  /** Web Push subscription (JSON). Omit for in-app only. */
  push?: { endpoint: string; keys: { p256dh: string; auth: string } };
}

export interface AlertRecord {
  id: string;
  hex?: string;
  callsign?: string;
  label: string;
  condition: AlertCondition;
  airport?: string;
  createdAt: number;
  expiresAt: number;
  firedAt?: number;
  active: boolean;
  push: boolean;
}

export interface CheckoutStart {
  provider: 'razorpay' | 'mock';
  /** Razorpay subscription id to open Checkout with. */
  subscriptionId: string;
  keyId: string;
  planId: string;
  name: string;
  description: string;
  prefill?: { email?: string };
}

export interface UsageEvent {
  feature: string;
  event: 'view' | 'use' | 'locked' | 'upsell_click';
  count: number;
}
