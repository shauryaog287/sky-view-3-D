import { render } from 'preact';
import { App } from './app';
import { loadConfigAndEntitlements, handleDeepLink } from './state/bootstrap';
import { initAuth } from './lib/auth';
import { initAnalytics } from './lib/analytics';
import './styles/app.css';

declare const CESIUM_BASE_URL: string;
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;

render(<App />, document.getElementById('app')!);
void initAuth().then(loadConfigAndEntitlements);
initAnalytics();
void handleDeepLink();

// Service worker: offline app shell + Web Push. Registered only in production builds.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
