# Android app (Trusted Web Activity)

SkyView 3D ships as an installable PWA first. To publish on Google Play later, wrap the deployed PWA in a Trusted Web
Activity (TWA): a thin Android shell that opens your site full-screen in Chrome, with the same code and updates.

## Prerequisites
- The PWA deployed on its final HTTPS domain (e.g. `https://skyview3d.app`), installable (manifest + service worker —
  already done), and a privacy policy URL (`/legal/privacy.html`).
- A Google Play developer account (one-time fee) and Java 17 + Android SDK (Bubblewrap can install them).

## Steps
1. `npm i -g @bubblewrap/cli`
2. `bubblewrap init --manifest https://<your-domain>/manifest.webmanifest`
   - Package id e.g. `app.skyview3d.twa`, launcher name "SkyView 3D", theme/background `#060b14`.
   - Enable notifications delegation (so Web Push alerts show as Android notifications).
3. `bubblewrap build` → `app-release-bundle.aab` (upload to Play) and a signing key (back it up!).
4. **Digital Asset Links** — prove the site and the app belong together, otherwise Chrome shows a URL bar:
   - In Play Console → *Setup → App integrity → App signing*, copy the **SHA-256 certificate fingerprint**.
   - Serve `https://<your-domain>/.well-known/assetlinks.json`:
     ```json
     [{
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": { "namespace": "android_app", "package_name": "app.skyview3d.twa",
                   "sha256_cert_fingerprints": ["AB:CD:...:EF"] }
     }]
     ```
     Put it at `public/.well-known/assetlinks.json` and redeploy Pages.
5. Play Console listing: screenshots (tablet + phone), privacy policy URL, **Data safety** form (matches
   `/legal/privacy.html`: optional email, optional purchase history, no location), content rating, target audience 13+.

## ⚠ Payments inside a Play-distributed app
Google Play's payments policy generally requires **Google Play Billing** for digital subscriptions sold inside an app
distributed through Play. India has a *user choice billing* programme that allows an alternative biller (e.g.
Razorpay) alongside Play Billing at a reduced service fee, subject to enrolment and conditions. Decide before
enabling paid plans in the Android app:
- keep the Play app free and sell subscriptions only on the website, or
- add Play Billing (Digital Goods API in TWAs) as a second `PaymentProvider`, possibly with user choice billing.
The code is ready for either: payments are behind the `PaymentProvider` interface and `LAUNCH_MODE`.
