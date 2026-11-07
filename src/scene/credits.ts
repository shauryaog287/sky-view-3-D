import { Credit, type Viewer } from 'cesium';
import { effect } from '@preact/signals';
import { appConfig } from '../state/entitlements';

/**
 * Data attributions live in Cesium's own credit bar, next to the Google / Cesium / Bing credits, so they are always on
 * screen (ODbL and CC BY require visible attribution) and can never be covered by our panels.
 */
export function installDataCredits(viewer: Viewer): () => void {
  const added: Credit[] = [];
  const set = (html: string[]) => {
    for (const c of added.splice(0)) viewer.creditDisplay.removeStaticCredit(c);
    for (const h of html) {
      const c = new Credit(h, true);
      viewer.creditDisplay.addStaticCredit(c);
      added.push(c);
    }
  };
  return effect(() => {
    // One short credit (phones are narrow); the full list with licences is one tap away on the Data sources page.
    const providers = appConfig.value?.providers ?? [{ id: 'adsblol', attribution: 'adsb.lol (ODbL 1.0)' }];
    const flight = providers.map((p) => shortName(p.attribution)).join(', ');
    set([`<a href="/legal/sources.html" target="_blank" rel="noopener">Data: ${escapeHtml(flight)} · Open-Meteo · OurAirports ⓘ</a>`]);
  });
}

function shortName(attribution: string) {
  if (/adsb\.lol/i.test(attribution)) return 'adsb.lol (ODbL)';
  if (/opensky/i.test(attribution)) return 'OpenSky';
  if (/airplanes\.live/i.test(attribution)) return 'airplanes.live';
  return attribution.length > 28 ? `${attribution.slice(0, 26)}…` : attribution;
}

/** Keep panels above the credit bar whatever its height (it wraps on narrow screens). */
export function trackCreditBarHeight(viewer: Viewer): () => void {
  const bar = viewer.container.querySelector<HTMLElement>('.cesium-viewer-bottom');
  if (!bar || typeof ResizeObserver === 'undefined') return () => {};
  const ro = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--credits-h', `${Math.ceil(bar.getBoundingClientRect().height) + 4}px`);
  });
  ro.observe(bar);
  return () => ro.disconnect();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
