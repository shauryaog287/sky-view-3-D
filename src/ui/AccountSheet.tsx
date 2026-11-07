import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { accountOpen } from '../state/account';
import { appConfig, entitlement, isPro, launchMode } from '../state/entitlements';
import { authAvailable, authUser, sendEmailCode, signInWithGoogle, signOut, verifyEmailCode } from '../lib/auth';
import { checkoutBusy, startCheckout } from '../lib/checkout';
import { api } from '../api';
import { toast } from '../state/store';
import { PLANS, formatInr } from '../config/plans';
import { fmtDate } from '../lib/format';

/** Account: sign in (email code / Google), plan, renewal date, cancel. */
export function AccountSheet() {
  if (!accountOpen.value) return null;
  return (
    <Sheet title="Account" onClose={() => (accountOpen.value = false)} testId="account">
      {authUser.value ? <SignedIn /> : <SignIn />}
    </Sheet>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  if (!authAvailable) {
    return (
      <div>
        <p class="muted">Sign-in is not set up on this server yet. Everything is free during launch — no account needed.</p>
      </div>
    );
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message || 'Sign-in failed', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="signin">
      <p class="muted">Sign in to keep alerts and subscriptions across devices.{launchMode.value === 'open' && ' All features are free during launch.'}</p>
      <button class="btn google" disabled={busy} onClick={() => run(signInWithGoogle)} data-testid="google-signin">
        <span aria-hidden="true">G</span> Continue with Google
      </button>
      <div class="or">or</div>
      {step === 'email' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await sendEmailCode(email.trim());
              setStep('code');
            });
          }}
        >
          <label class="field text-field">
            <span>Email</span>
            <input type="email" required autoComplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} data-testid="email" />
          </label>
          <button class="btn primary wide" disabled={busy || !email.includes('@')} data-testid="send-code">
            Email me a sign-in code
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => verifyEmailCode(email.trim(), code.trim()));
          }}
        >
          <label class="field text-field">
            <span>6-digit code sent to {email}</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} data-testid="otp" />
          </label>
          <button class="btn primary wide" disabled={busy || code.trim().length < 6} data-testid="verify-code">
            Sign in
          </button>
          <button type="button" class="linkish" onClick={() => setStep('email')}>
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}

function SignedIn() {
  const e = entitlement.value;
  const cfg = appConfig.value;
  const [busy, setBusy] = useState(false);
  const paymentsOn = api.mode === 'mock' || !!cfg?.payments.enabled;
  const cancel = async () => {
    if (!confirm('Cancel your subscription? You keep Pro until the end of the period you paid for.')) return;
    setBusy(true);
    try {
      entitlement.value = await api.cancelSubscription();
      toast('Subscription cancelled. Pro stays on until the end of the period.');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="account-signed-in">
      <dl class="kv">
        <dt>Signed in as</dt>
        <dd>{authUser.value?.email ?? authUser.value?.id}</dd>
        <dt>Plan</dt>
        <dd data-testid="plan">{isPro.value ? (PLANS.find((p) => p.id === e?.plan)?.name ?? 'Pro') : 'Free'}</dd>
        {e?.status && (
          <>
            <dt>Status</dt>
            <dd>{e.cancelAtPeriodEnd ? 'Cancelled — active until period end' : e.status}</dd>
          </>
        )}
        {e?.currentPeriodEnd && (
          <>
            <dt>{e.cancelAtPeriodEnd ? 'Pro until' : 'Renews on'}</dt>
            <dd data-testid="renew-date">{fmtDate(e.currentPeriodEnd)}</dd>
          </>
        )}
      </dl>
      {launchMode.value === 'open' && <p class="note">🎉 Every feature is free during launch. Subscriptions below run in Razorpay test mode for testing only.</p>}
      {isPro.value && !e?.cancelAtPeriodEnd && (
        <button class="btn danger wide" disabled={busy} onClick={cancel} data-testid="cancel-sub">
          Cancel subscription
        </button>
      )}
      {!isPro.value && paymentsOn && <PlanCards />}
      {!paymentsOn && <p class="muted">Subscriptions are not enabled on this server.</p>}
      <button class="linkish" onClick={() => void signOut()} data-testid="sign-out">
        Sign out
      </button>
    </div>
  );
}

export function PlanCards() {
  return (
    <div class="plans">
      {PLANS.map((p) => (
        <div key={p.id} class="plan">
          <div class="plan-name">{p.name}</div>
          <div class="plan-price num">
            {formatInr(p.amountPaise)}
            <span>/{p.period === 'yearly' ? 'year' : 'month'}</span>
          </div>
          <div class="hint">{p.note}</div>
          <button
            class="btn primary wide"
            disabled={checkoutBusy.value}
            onClick={() => {
              if (!authUser.value) {
                accountOpen.value = true;
                toast('Sign in first, then pick a plan.', 'info');
                return;
              }
              void startCheckout(p.id).catch(() => undefined);
            }}
            data-testid={`buy-${p.id}`}
          >
            Choose {p.period === 'yearly' ? 'yearly' : 'monthly'}
          </button>
        </div>
      ))}
    </div>
  );
}
