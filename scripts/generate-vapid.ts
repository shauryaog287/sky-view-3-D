/**
 * Generates a VAPID key pair for Web Push.
 *
 *   npm run vapid:generate
 *
 * Put the PUBLIC key in worker/wrangler.toml [vars] VAPID_PUBLIC_KEY (and optionally VITE_VAPID_PUBLIC_KEY), and the
 * PRIVATE key in a secret:  npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml
 * Never commit the private key. Rotating keys invalidates existing push subscriptions.
 */
import { b64urlEncode } from '../shared/base64url';

const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const publicKey = b64urlEncode(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
console.log('VAPID_PUBLIC_KEY=' + publicKey);
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
console.log('\nPublic key → worker/wrangler.toml [vars] VAPID_PUBLIC_KEY (served to the app via /api/config).');
console.log('Private key → npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml');
