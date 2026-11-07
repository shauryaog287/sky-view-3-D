import { signal } from '@preact/signals';
import { api, ApiError } from '../api';
import { refreshEntitlements } from '../state/bootstrap';
import { entitlement } from '../state/entitlements';
import { toast } from '../state/store';
import type { CheckoutStart } from '../../shared/apiTypes';

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: unknown) => void): void };
  }
}

/** Mock checkout dialog state (mock mode only — no money, no provider). */
export const mockCheckout = signal<CheckoutStart | null>(null);
export const checkoutBusy = signal(false);

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay Checkout'));
    document.head.appendChild(s);
  });
}

/** Start a subscription checkout for a plan. Razorpay test mode in production builds; a fake sheet in mock mode. */
export async function startCheckout(planId: string): Promise<void> {
  checkoutBusy.value = true;
  try {
    const start = await api.startCheckout(planId);
    if (start.provider === 'mock') {
      mockCheckout.value = start;
      return;
    }
    await loadRazorpay();
    const rzp = new window.Razorpay!({
      key: start.keyId,
      subscription_id: start.subscriptionId,
      name: start.name,
      description: start.description,
      prefill: start.prefill ?? {},
      theme: { color: '#39d0ff' },
      handler: async (resp: Record<string, string>) => {
        try {
          entitlement.value = await api.confirmCheckout(resp);
          toast('Welcome to SkyView Pro! ✈', 'info', 6000);
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      },
      modal: { ondismiss: () => toast('Checkout closed — you have not been charged.') },
    });
    rzp.on('payment.failed', () => toast('Payment failed. You have not been charged.', 'error'));
    rzp.open();
  } catch (e) {
    const err = e as ApiError;
    if (err.code === 'sign_in_required') toast('Sign in first to subscribe.', 'warn');
    else if (err.code === 'payments_not_configured') toast('Subscriptions are not available yet — everything is free during launch.', 'warn', 6000);
    else toast(err.message || 'Checkout failed', 'error');
    throw e;
  } finally {
    checkoutBusy.value = false;
  }
}

export async function confirmMockCheckout() {
  const m = mockCheckout.value;
  if (!m) return;
  entitlement.value = await api.confirmCheckout({ planId: m.planId });
  mockCheckout.value = null;
  toast('Test subscription active (mock).', 'info');
  await refreshEntitlements();
}
