import { env } from '../config/env';
import { api } from '../api';
import { featureUsage } from '../state/entitlements';
import { analyticsOptOut } from '../state/settings';
import type { FeatureId } from '../config/features';
import type { UsageEvent } from '../../shared/apiTypes';

/**
 * Privacy-friendly per-feature usage analytics, used later to decide what to put behind the paywall.
 *  - Default sink "self": counts are aggregated in the browser and sent to our own /api/events as daily totals.
 *    No cookies, no user/device id, no IP stored.
 *  - Optional sinks: Plausible (cookieless) or PostHog (anonymous, person profiles disabled, in-memory id only).
 *  - Disabled by the in-app opt-out, Do-Not-Track and Global Privacy Control.
 */
type Ev = UsageEvent['event'];
const counts = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | undefined;
const sessionId = crypto.randomUUID(); // never persisted

function allowed(): boolean {
  if (env.analytics === 'none' || analyticsOptOut.value) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  if (nav.globalPrivacyControl || nav.doNotTrack === '1') return false;
  return true;
}

export function track(feature: FeatureId, event: Ev) {
  if (!allowed()) return;
  if (env.analytics === 'plausible' && env.plausibleDomain) {
    void fetch('https://plausible.io/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'feature', url: `${location.origin}/`, domain: env.plausibleDomain, props: { feature, event } }),
      keepalive: true,
    }).catch(() => undefined);
    return;
  }
  if (env.analytics === 'posthog' && env.posthogKey) {
    void fetch(`${env.posthogHost.replace(/\/$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: env.posthogKey, event: `feature_${event}`, distinct_id: sessionId, properties: { feature, $process_person_profile: false } }),
      keepalive: true,
    }).catch(() => undefined);
    return;
  }
  const k = `${feature}|${event}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}

export function flush() {
  if (!counts.size || !allowed()) {
    counts.clear();
    return;
  }
  const events: UsageEvent[] = [...counts].map(([k, count]) => {
    const [feature, event] = k.split('|');
    return { feature, event: event as Ev, count };
  });
  counts.clear();
  void api.sendUsage(events).catch(() => undefined);
}

export function initAnalytics() {
  featureUsage.track = track;
  timer ??= setInterval(flush, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
