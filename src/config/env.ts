/** Typed access to build-time environment. Only VITE_* variables are available in the browser. */
export type ApiMode = 'http' | 'mock';

const raw = import.meta.env;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export const env = {
  apiMode: (str(raw.VITE_API_MODE) === 'mock' ? 'mock' : 'http') as ApiMode,
  apiBase: str(raw.VITE_API_BASE) ?? '',
  launchMode: str(raw.VITE_LAUNCH_MODE) === 'freemium' ? ('freemium' as const) : ('open' as const),
  cesiumIonToken: str(raw.VITE_CESIUM_ION_TOKEN),
  arcgisApiKey: str(raw.VITE_ARCGIS_API_KEY),
  supabaseUrl: str(raw.VITE_SUPABASE_URL),
  supabaseAnonKey: str(raw.VITE_SUPABASE_ANON_KEY),
  vapidPublicKey: str(raw.VITE_VAPID_PUBLIC_KEY),
  analytics: (str(raw.VITE_ANALYTICS) ?? 'self') as 'none' | 'self' | 'plausible' | 'posthog',
  plausibleDomain: str(raw.VITE_PLAUSIBLE_DOMAIN),
  posthogKey: str(raw.VITE_POSTHOG_KEY),
  posthogHost: str(raw.VITE_POSTHOG_HOST) ?? 'https://eu.i.posthog.com',
  isDev: raw.DEV,
};
