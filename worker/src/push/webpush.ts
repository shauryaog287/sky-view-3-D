import { b64urlDecode, b64urlEncode } from '../../../shared/base64url';

/**
 * Web Push for Cloudflare Workers using only WebCrypto:
 *  - payload encryption: RFC 8291 (Message Encryption for Web Push) with RFC 8188 "aes128gcm" content coding,
 *  - authentication: RFC 8292 VAPID (ES256-signed JWT).
 * The npm "web-push" package needs Node crypto, so this is a small self-contained implementation, verified against
 * the RFC 8291 Appendix A test vector (worker/test/webpush.test.ts).
 */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidConfig {
  /** Uncompressed P-256 public key, base64url (65 bytes). */
  publicKey: string;
  /** Private scalar d, base64url (32 bytes). */
  privateKey: string;
  /** "mailto:you@example.com" or an https URL. */
  subject: string;
}

type Bytes = Uint8Array<ArrayBuffer>;
const te = new TextEncoder();

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key as Bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as Bytes));
}

function publicJwk(raw: Uint8Array, d?: string): JsonWebKey {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('expected an uncompressed P-256 public key');
  return { kty: 'EC', crv: 'P-256', x: b64urlEncode(raw.slice(1, 33)), y: b64urlEncode(raw.slice(33, 65)), ...(d ? { d } : {}), ext: true };
}

export interface EncryptOptions {
  /** Fixed sender key pair (tests only). */
  asPublic?: Uint8Array;
  asPrivateD?: string;
  /** Fixed salt (tests only). */
  salt?: Uint8Array;
  recordSize?: number;
}

/** Encrypt a push message body for one subscription (single aes128gcm record). */
export async function encryptPayload(plaintext: Uint8Array, keys: PushSubscriptionJson['keys'], o: EncryptOptions = {}): Promise<Bytes> {
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  const salt = (o.salt ?? crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))) as Bytes;
  const rs = o.recordSize ?? 4096;

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (o.asPublic && o.asPrivateD) {
    asPublic = o.asPublic;
    asPrivate = await crypto.subtle.importKey('jwk', publicJwk(o.asPublic, o.asPrivateD), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // (Workers' type definitions call the standard `public` member `$public`; the runtime uses `public`.)
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, asPrivate, 256));

  // RFC 8291 §3.4: combine the ECDH secret with the auth secret.
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(te.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  // RFC 8188 §2.2: content encryption key and nonce.
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  if (plaintext.length + 1 + 16 > rs) throw new Error('payload too large for one record');
  const padded = concat(plaintext, new Uint8Array([2])); // last-record delimiter
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, padded));

  const header = new Uint8Array(new ArrayBuffer(16 + 4 + 1));
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** VAPID `Authorization` header value for an endpoint. */
export async function vapidAuthorization(endpoint: string, v: VapidConfig, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(te.encode(JSON.stringify({ aud, exp: nowS + 12 * 3600, sub: v.subject })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey('jwk', publicJwk(b64urlDecode(v.publicKey), v.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto returns the IEEE P1363 (r || s) signature, which is exactly the JWS ES256 format.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${v.publicKey}`;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** Subscription is gone (404/410): delete it. */
  gone: boolean;
}

export async function sendWebPush(
  sub: PushSubscriptionJson,
  payload: unknown,
  v: VapidConfig,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<PushResult> {
  const body = await encryptPayload(te.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)), sub.keys);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, v),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 3600),
    Urgency: opts.urgency ?? 'high',
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const res = await fetchImpl(sub.endpoint, { method: 'POST', headers, body });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
