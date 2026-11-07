import type { Env } from '../env';
import { intVar, listVar } from '../env';
import { adsbLolProvider, airplanesLiveProvider } from './readsb';
import { OpenSkyProvider } from './opensky';
import { CommercialProviderStub } from './commercialStub';
import { FixtureProvider } from './fixture';
import { globalFetch, type FetchLike, type ProviderAdapter } from './types';

export const DEFAULT_PROVIDERS = ['adsblol', 'airplaneslive', 'opensky'];

/**
 * Build the provider list from config. Order matters: earlier providers are preferred when tokens are scarce.
 * Switching to a licensed feed is a config change: PROVIDERS=commercial (+ COMMERCIAL_PROVIDER / COMMERCIAL_API_KEY).
 * Providers missing credentials are skipped silently and reported as disabled in /api/status.
 */
export function createProviders(env: Env, fetchImpl: FetchLike = globalFetch): { active: ProviderAdapter[]; skipped: string[] } {
  const active: ProviderAdapter[] = [];
  const skipped: string[] = [];
  for (const id of listVar(env.PROVIDERS, DEFAULT_PROVIDERS)) {
    switch (id) {
      case 'adsblol':
        active.push(adsbLolProvider(fetchImpl));
        break;
      case 'airplaneslive':
        active.push(airplanesLiveProvider(fetchImpl));
        break;
      case 'opensky':
        if (env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) {
          active.push(new OpenSkyProvider(env.OPENSKY_CLIENT_ID, env.OPENSKY_CLIENT_SECRET, fetchImpl, intVar(env.OPENSKY_DAILY_CREDITS, 4000)));
        } else skipped.push('opensky (no OPENSKY_CLIENT_ID/SECRET)');
        break;
      case 'commercial':
        active.push(new CommercialProviderStub(env.COMMERCIAL_PROVIDER, env.COMMERCIAL_API_KEY));
        break;
      case 'fixture':
        active.push(new FixtureProvider());
        break;
      default:
        skipped.push(`${id} (unknown)`);
    }
  }
  return { active, skipped };
}
