import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Ctx } from './context';
import type { Env } from './env';

export interface AuthUser {
  id: string;
  email?: string;
}

export interface VerifyOptions {
  /** Legacy Supabase JWT secret (HS256). */
  secret?: string;
  /** JWKS resolver (new Supabase asymmetric signing keys: ES256/RS256). */
  jwks?: JWTVerifyGetKey;
  issuer?: string;
}

/** Verify a Supabase access token. Returns undefined for anything invalid, expired or anonymous. */
export async function verifySupabaseJwt(token: string, o: VerifyOptions): Promise<AuthUser | undefined> {
  const common = { audience: 'authenticated', issuer: o.issuer, clockTolerance: 30 };
  try {
    let payload;
    if (o.jwks) {
      try {
        ({ payload } = await jwtVerify(token, o.jwks, common));
      } catch (e) {
        if (!o.secret) throw e;
        ({ payload } = await jwtVerify(token, new TextEncoder().encode(o.secret), { ...common, algorithms: ['HS256'] }));
      }
    } else if (o.secret) {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(o.secret), { ...common, algorithms: ['HS256'] }));
    } else return undefined;
    if (typeof payload.sub !== 'string' || payload.is_anonymous === true) return undefined;
    return { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
  } catch {
    return undefined;
  }
}

let jwksCache: { url: string; set: JWTVerifyGetKey } | undefined;
function jwksFor(env: Env): JWTVerifyGetKey | undefined {
  if (!env.SUPABASE_URL) return undefined;
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  if (jwksCache?.url !== url) jwksCache = { url, set: createRemoteJWKSet(new URL(url), { cooldownDuration: 60_000, cacheMaxAge: 600_000 }) };
  return jwksCache.set;
}

const resolved = new WeakMap<Request | Ctx, Promise<AuthUser | undefined>>();

/** Resolve the signed-in user from `Authorization: Bearer <Supabase access token>` (memoised per request). */
export function resolveUser(ctx: Ctx & { req?: Request }): Promise<AuthUser | undefined> {
  const hit = resolved.get(ctx);
  if (hit) return hit;
  const p = (async () => {
    const h = ctx.authHeader;
    if (!h?.startsWith('Bearer ')) return undefined;
    const env = ctx.env;
    if (!env.SUPABASE_URL && !env.SUPABASE_JWT_SECRET) return undefined;
    return verifySupabaseJwt(h.slice(7), {
      secret: env.SUPABASE_JWT_SECRET,
      jwks: env.SUPABASE_URL ? jwksFor(env) : undefined,
      issuer: env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined,
    });
  })();
  resolved.set(ctx, p);
  return p;
}

export async function requireUser(ctx: Ctx): Promise<AuthUser> {
  const u = await resolveUser(ctx);
  if (!u) {
    const { HttpError } = await import('./lib/http');
    throw new HttpError(401, 'sign_in_required', 'Please sign in first');
  }
  return u;
}
