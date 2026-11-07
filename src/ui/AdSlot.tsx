import { canUseFeature } from '../state/entitlements';

/**
 * Placeholder for future ads. Renders nothing today (there are no ads at launch); once an ad network is added, render
 * it here only when the user lacks the Pro "no_ads" feature.
 */
export function AdSlot(_props: { placement: 'map-corner' | 'panel-footer' }) {
  const adsEnabled = false;
  if (!adsEnabled || canUseFeature('no_ads')) return null;
  return null;
}
