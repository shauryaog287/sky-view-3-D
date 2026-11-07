import { describe, expect, it } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { verifySupabaseJwt } from '../src/auth';

const ISS = 'https://abc.supabase.co/auth/v1';

describe('Supabase JWT verification', () => {
  it('accepts a valid HS256 token (legacy JWT secret) and rejects tampering / expiry / anon', async () => {
    const secret = 'super-secret-jwt-token-with-at-least-32-characters';
    const key = new TextEncoder().encode(secret);
    const good = await new SignJWT({ email: 'pilot@example.com', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-123')
      .setAudience('authenticated')
      .setIssuer(ISS)
      .setExpirationTime('1h')
      .sign(key);
    expect(await verifySupabaseJwt(good, { secret, issuer: ISS })).toEqual({ id: 'user-123', email: 'pilot@example.com' });
    expect(await verifySupabaseJwt(good, { secret: secret + 'x', issuer: ISS })).toBeUndefined();
    const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setAudience('authenticated').setIssuer(ISS).setExpirationTime(Math.floor(Date.now() / 1000) - 3600).sign(key);
    expect(await verifySupabaseJwt(expired, { secret, issuer: ISS })).toBeUndefined();
    const anon = await new SignJWT({ is_anonymous: true }).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setAudience('authenticated').setIssuer(ISS).setExpirationTime('1h').sign(key);
    expect(await verifySupabaseJwt(anon, { secret, issuer: ISS })).toBeUndefined();
  });

  it('accepts ES256 tokens from the project JWKS (asymmetric signing keys)', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
    const jwks = createLocalJWKSet({ keys: [jwk] });
    const tok = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject('user-9').setAudience('authenticated').setIssuer(ISS).setExpirationTime('1h').sign(privateKey);
    expect(await verifySupabaseJwt(tok, { jwks, issuer: ISS })).toEqual({ id: 'user-9', email: undefined });
    expect(await verifySupabaseJwt(tok, { jwks, issuer: 'https://evil.example/auth/v1' })).toBeUndefined();
  });
});
