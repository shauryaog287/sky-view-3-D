import { api } from '../api';
import { appConfig, entitlement, launchMode, tierOverrides } from './entitlements';
import { showAircraft, follow } from './actions';
import { toast } from './store';
import { sceneReady } from './store';

/** Load runtime config (LAUNCH_MODE etc. — the Worker is the source of truth) and the user's entitlements. */
export async function loadConfigAndEntitlements() {
  try {
    const cfg = await api.config();
    appConfig.value = cfg;
    launchMode.value = cfg.launchMode;
    tierOverrides.value = cfg.tierOverrides;
  } catch {
    /* keep build-time defaults (VITE_LAUNCH_MODE) */
  }
  await refreshEntitlements();
}

export async function refreshEntitlements() {
  try {
    const e = await api.entitlements();
    entitlement.value = e;
    launchMode.value = e.launchMode;
  } catch {
    /* anonymous / offline: no subscription */
  }
}

/** `/?follow=<hex>` (from alert notifications and shared links): find the flight and chase it. */
export async function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const hex = params.get('follow');
  if (!hex) return;
  const wait = () => new Promise<void>((r) => (sceneReady.value ? r() : setTimeout(() => wait().then(r), 200)));
  await wait();
  const res = await api.search(hex).catch(() => undefined);
  const hit = res?.aircraft.find((a) => a.hex === hex.toLowerCase()) ?? res?.aircraft[0];
  if (!hit) {
    toast('That flight is not visible right now.', 'warn');
    return;
  }
  showAircraft(hit);
  setTimeout(() => follow(hit.hex, 'chase'), 2000);
  params.delete('follow');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
}
