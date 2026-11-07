import { b64urlDecode } from '../../shared/base64url';

export type PushSupport = 'supported' | 'unsupported' | 'denied' | 'no-key';

export function pushSupport(vapidKey: string | undefined): PushSupport {
  if (!vapidKey) return 'no-key';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'supported';
}

/** Ask for notification permission and subscribe this device to Web Push with our VAPID key. */
export async function subscribePush(vapidKey: string): Promise<PushSubscriptionJSON | undefined> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return undefined;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlDecode(vapidKey),
    }));
  return sub.toJSON();
}

/** Local notification (used by the in-app alert monitor). Falls back silently when not permitted. */
export async function notify(title: string, body: string, url = '/') {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) await reg.showNotification(title, { body, icon: '/icons/icon-192.png', data: { url } });
    else new Notification(title, { body });
  } catch {
    /* ignore */
  }
}
