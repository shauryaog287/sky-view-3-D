import { env } from '../config/env';
import type { ApiClient } from './client';
import { HttpApiClient } from './httpClient';
import { MockApiClient } from './mockClient';

/** The app-wide API client: real Worker API, or the in-browser mock in mock mode (or with ?mock=1). */
function create(): ApiClient {
  let forceMock = false;
  try {
    forceMock = new URLSearchParams(location.search).get('mock') === '1';
  } catch {
    /* non-browser */
  }
  return env.apiMode === 'mock' || forceMock ? new MockApiClient() : new HttpApiClient(env.apiBase);
}

export const api: ApiClient = create();
export { ApiError } from './client';
