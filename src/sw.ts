/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

/**
 * Service worker: offline app shell (not data) + Web Push notifications.
 *  - The built app (HTML/JS/CSS/models/icons/airports) is precached.
 *  - Cesium's static assets (workers, offline Natural Earth imagery) are cached on first use.
 *  - /api/* is network-only: live flight data must never come from a stale cache.
 */
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/legal\//] }));
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/cesiumStatic/'),
  new CacheFirst({ cacheName: 'cesium-static', plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 30 * 86_400 })] }),
);
registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/'), new NetworkOnly());

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; tag?: string; url?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'SkyView 3D', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'SkyView 3D', {
      body: data.body,
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await (w as WindowClient).navigate(url).catch(() => undefined);
          return (w as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});
