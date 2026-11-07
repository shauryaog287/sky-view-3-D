import { Sheet } from './Sheet';
import { featureUsage, tierOverrides, upsellFor } from '../state/entitlements';
import { FEATURES, FEATURE_IDS, tierOf } from '../config/features';
import { PlanCards } from './AccountSheet';
import { authUser } from '../lib/auth';
import { accountOpen } from '../state/account';
import { confirmMockCheckout, mockCheckout } from '../lib/checkout';

/** Tasteful upsell for a locked Pro feature — never a broken screen. */
export function UpsellSheet() {
  const id = upsellFor.value;
  if (!id) return null;
  const f = FEATURES[id];
  const pro = FEATURE_IDS.filter((x) => tierOf(x, tierOverrides.value) === 'pro');
  const close = () => (upsellFor.value = null);
  return (
    <Sheet title="SkyView Pro" onClose={close} testId="upsell">
      <p class="upsell-lead">
        <strong>{f.label}</strong> is part of SkyView Pro. {f.pitch}
      </p>
      <ul class="pro-list">
        {pro.map((x) => (
          <li key={x} class={x === id ? 'hl' : ''}>
            ✓ {FEATURES[x].label}
          </li>
        ))}
      </ul>
      {!authUser.value && (
        <button
          class="btn wide"
          onClick={() => {
            featureUsage.track(id, 'upsell_click');
            close();
            accountOpen.value = true;
          }}
          data-testid="upsell-signin"
        >
          Sign in to upgrade
        </button>
      )}
      {authUser.value && (
        <div onClick={() => featureUsage.track(id, 'upsell_click')}>
          <PlanCards />
        </div>
      )}
      <button class="linkish" onClick={close}>
        Not now
      </button>
    </Sheet>
  );
}

/** Mock-mode stand-in for Razorpay Checkout (no provider, no money). */
export function MockCheckoutSheet() {
  const m = mockCheckout.value;
  if (!m) return null;
  return (
    <Sheet title="Test checkout" onClose={() => (mockCheckout.value = null)} testId="mock-checkout">
      <p class="muted">
        Mock mode — this simulates Razorpay Checkout for <strong>{m.description}</strong>. No money moves.
      </p>
      <button class="btn primary wide" onClick={() => void confirmMockCheckout()} data-testid="mock-pay">
        Simulate successful payment
      </button>
    </Sheet>
  );
}
