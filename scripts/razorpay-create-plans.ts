/**
 * Creates the Pro Monthly / Pro Yearly plans in your Razorpay TEST account from src/config/plans.ts.
 *
 *   RAZORPAY_KEY_ID=rzp_test_... RAZORPAY_KEY_SECRET=... npm run razorpay:plans
 *   (or put both in worker/.dev.vars)
 *
 * Prints RAZORPAY_PLAN_MONTHLY / RAZORPAY_PLAN_YEARLY to paste into worker/wrangler.toml [vars].
 * Refuses live keys on purpose.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS } from '../src/config/plans';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const devVars = join(root, 'worker', '.dev.vars');
const fileVars: Record<string, string> = {};
if (existsSync(devVars)) {
  for (const line of readFileSync(devVars, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) fileVars[m[1]] = m[2];
  }
}
const keyId = process.env.RAZORPAY_KEY_ID || fileVars.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET || fileVars.RAZORPAY_KEY_SECRET;
if (!keyId || !keySecret) {
  console.error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys) first.');
  process.exit(1);
}
if (!keyId.startsWith('rzp_test_')) {
  console.error('Refusing: this script only works with TEST keys (rzp_test_...).');
  process.exit(1);
}
const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
for (const p of PLANS) {
  const res = await fetch('https://api.razorpay.com/v1/plans', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: p.period,
      interval: 1,
      item: { name: `SkyView 3D ${p.name}`, amount: p.amountPaise, currency: p.currency, description: p.note },
      notes: { app_plan: p.id },
    }),
  });
  const body = (await res.json()) as { id?: string; error?: { description: string } };
  if (!res.ok) {
    console.error(`${p.id}: ${body.error?.description ?? res.status}`);
    process.exit(1);
  }
  console.log(`${p.id === 'pro_monthly' ? 'RAZORPAY_PLAN_MONTHLY' : 'RAZORPAY_PLAN_YEARLY'}=${body.id}`);
}
