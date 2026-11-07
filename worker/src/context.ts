import type { Env } from './env';

/** Per-request context passed to route handlers. */
export interface Ctx {
  env: Env;
  exec: ExecutionContext;
  url: URL;
  /** Anonymous per-install id sent by the client (X-Device-Id), used for caps and alerts. */
  deviceId?: string;
  /** Raw Authorization header (verified lazily by resolveUser). */
  authHeader?: string;
}

export function hub(env: Env): DurableObjectStub {
  return env.FLIGHT_HUB.get(env.FLIGHT_HUB.idFromName('global'));
}
