import { describe, expect, it } from 'vitest';
import { encryptPayload, sendWebPush, vapidAuthorization } from '../src/push/webpush';
import { b64urlDecode, b64urlEncode } from '../../shared/base64url';

// RFC 8291 §5 / Appendix A test vector.
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  expected:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('Web Push (RFC 8291 / 8292)', () => {
  it('reproduces the RFC 8291 example byte for byte', async () => {
    const out = await encryptPayload(new TextEncoder().encode(V.plaintext), { p256dh: V.uaPublic, auth: V.auth }, {
      asPublic: b64urlDecode(V.asPublic),
      asPrivateD: V.asPrivate,
      salt: b64urlDecode(V.salt),
    });
    // 86-byte header + 41-byte message + delimiter + 16-byte tag. (The RFC text says Content-Length: 145; the
    // encoded body itself is 144 bytes.)
    expect(out.length).toBe(144);
    expect(b64urlEncode(out)).toBe(V.expected);
  });

  it('signs a verifiable VAPID ES256 JWT for the endpoint origin', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = b64urlEncode((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
    const d = ((await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey).d!;
    const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey: pub, privateKey: d, subject: 'mailto:test@example.com' }, 1_700_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(pub);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:test@example.com', exp: 1_700_000_000 + 43200 });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, b64urlDecode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });

  it('posts an encrypted body and flags gone subscriptions', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const vk = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    const sub = {
      endpoint: 'https://push.example.net/push/xyz',
      keys: { p256dh: b64urlEncode((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) },
    };
    const vapid = {
      publicKey: b64urlEncode((await crypto.subtle.exportKey('raw', vk.publicKey)) as ArrayBuffer),
      privateKey: ((await crypto.subtle.exportKey('jwk', vk.privateKey)) as JsonWebKey).d!,
      subject: 'mailto:a@b.c',
    };
    let seen: RequestInit | undefined;
    const r = await sendWebPush(sub, { title: 'IGO2134 is descending' }, vapid, { ttl: 600 }, async (_u, init) => {
      seen = init;
      return new Response(null, { status: 410 });
    });
    expect(r).toEqual({ ok: false, status: 410, gone: true });
    const headers = seen!.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe('600');
    expect((seen!.body as Uint8Array).length).toBeGreaterThan(86 + 16);
  });
});
