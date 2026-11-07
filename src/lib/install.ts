import { signal } from '@preact/signals';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** PWA install prompt (Chrome/Android). iOS has no prompt: users use Share → Add to Home Screen. */
export const installAvailable = signal(false);
export const isStandalone = signal(false);
let deferred: BeforeInstallPromptEvent | undefined;

export function initInstall() {
  try {
    isStandalone.value = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    /* ignore */
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    installAvailable.value = true;
  });
  addEventListener('appinstalled', () => {
    installAvailable.value = false;
    isStandalone.value = true;
  });
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = undefined;
  installAvailable.value = false;
  return outcome === 'accepted';
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
