# Needs from you

Everything here needs a human (accounts, keys, payments, legal). **The app already runs without any of it**: missing
items fall back to mocks, recorded fixtures or cheaper layers. Work top to bottom; each item says exactly where to click
and which variable to fill. Secrets go in `worker/.dev.vars` locally and `wrangler secret put NAME` in production;
public values go in `.env.local` (frontend) or `worker/wrangler.toml` `[vars]`.

## Checklist at a glance

| # | Item | Needed for | Priority |
| --- | --- | --- | --- |
| 1 | Cloudflare account, D1 database, Pages project | Deploying anything | **Now** |
| 2 | Email airplanes.live for API access | More live coverage | Now (5 min) |
| 3 | Google Maps Platform key (Map Tiles API) + quota | Photorealistic 3D airports | Now |
| 4 | Cesium ion token | Better fallback terrain/imagery | Now |
| 10 | OpenSky account (OAuth client) | More coverage, zoomed-out views | Now |
| 6 | VAPID keys (`npm run vapid:generate`) | Alerts while the app is closed | Now (2 min) |
| 7 | Supabase project + Google OAuth client | Sign-in, saved subscriptions | Before testing accounts |
| 8 | Razorpay account — **test mode** | Testing subscriptions | Before testing payments |
| 9 | Analytics admin token (optional) | Reading usage counts | Any time |
| 11 | Legal review of Privacy/Terms + your entity details | Publishing / Play Store | Before public launch |
| 14 | Custom domain | Branding, Play Store asset links | Before public launch |
| 5, 12 | Commercial weather + **licensed flight data** | Charging money | Before `LAUNCH_MODE=freemium` |
| 13 | Google Play developer account + billing decision | Android app | Later |
| 15 | ArcGIS key for the satellite layer | Commercial use of the satellite fallback | Before charging money |
| 16 | Licensed photoreal aircraft models (optional) | Photo-quality aircraft instead of generated ones | Any time |

## 1. Cloudflare account (required to deploy)
1. Sign up at https://dash.cloudflare.com/sign-up (free plan is enough to start; Durable Objects with SQLite storage
   are available on the free plan).
2. On your machine: `npx wrangler login`.
3. Create the database, then paste the printed id into `worker/wrangler.toml` (`[[d1_databases]] database_id`):
   ```bash
   npx wrangler d1 create skyview
   npm run db:migrate:remote
   ```
4. Create the Pages project once: `npx wrangler pages project create skyview-3d --production-branch main`.
5. `npm run deploy:api`, note the Worker URL, put `VITE_API_BASE=<that URL>` in `.env.production.local`, then
   `npm run deploy:web`. Add the Pages URL (and later your domain) to `ALLOWED_ORIGINS` in `worker/wrangler.toml`.
6. Expect the **Workers Paid plan ($5/month)** once real traffic arrives: D1 writes for track history exceed the free
   100k rows/day with a few hundred visible aircraft (see DECISIONS D-021).
7. For the GitHub "Deploy" workflow: create an API token (My Profile → API Tokens → *Edit Cloudflare Workers* template,
   plus *Cloudflare Pages: Edit* and *D1: Edit*), then add repository secrets `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID` and variable `VITE_API_BASE`.

## 2. airplanes.live access (optional, improves coverage)
- Their API now answers `403 Please contact us…` to unregistered clients. Email **contact@airplanes.live** with: a link
  to the app/repo, a description ("non-commercial live 3D flight viewer, server-side polling ~1 req/s via Cloudflare
  Workers, User-Agent `SkyView3D/0.1`"), and expected volume. Nothing to configure afterwards — it is already in
  `PROVIDERS`.

## 3. Google Photorealistic 3D Tiles (optional, the "wow" layer)
1. Go to https://console.cloud.google.com/ → create a project (e.g. `skyview-3d`) → **Billing**: attach a billing
   account (Map Tiles API has a monthly free allowance, then is billed per root tileset request).
2. **APIs & Services → Library → "Map Tiles API" → Enable.**
3. **APIs & Services → Credentials → Create credentials → API key.** Then *Edit API key*:
   - Application restrictions: **Websites** → add `https://skyview-3d.pages.dev/*`, your custom domain, and
     `http://localhost:5173/*` for development.
   - API restrictions: **Restrict key → Map Tiles API** only.
4. **APIs & Services → Map Tiles API → Quotas:** set a hard daily cap on "Create 3D Tiles session requests" (start
   with ~3,000/day; it should be ≥ `TILES_SESSIONS_GLOBAL_DAY`).
5. Store it on the Worker: `npx wrangler secret put GOOGLE_MAPS_API_KEY --config worker/wrangler.toml`
   (locally: `GOOGLE_MAPS_API_KEY=...` in `worker/.dev.vars`).
6. Tune caps in `worker/wrangler.toml`: `TILES_SESSIONS_PER_USER_DAY`, `TILES_SESSIONS_GLOBAL_DAY`.

## 4. Cesium ion token (optional, better fallback layer)
1. Sign up at https://ion.cesium.com/signup (free Community plan is fine for development; check the commercial terms
   before charging users).
2. **Access Tokens → Create token**: scopes `assets:read`, assets: *Cesium World Terrain* (1), *Bing Maps Aerial* (2)
   (and *Google Photorealistic 3D Tiles* (2275207) if you want Google tiles through ion instead of your own key).
   Set **Allowed URLs** to your Pages domain + `http://localhost:5173`.
3. Put it in `worker/.dev.vars` / `wrangler secret put CESIUM_ION_TOKEN` (the Worker hands it to the browser), or in
   `.env.local` as `VITE_CESIUM_ION_TOKEN`.

## 5. Weather data licensing (before you charge money)
- **Open-Meteo** is free for non-commercial use only. Before `LAUNCH_MODE=freemium` with live payments, buy an API
  plan at https://open-meteo.com/en/pricing and put the key in the Worker (the code then needs `&apikey=` and the
  `customer-api.open-meteo.com` host — a one-line change in `worker/src/routes/weather.ts`).
- **aviationweather.gov** (NOAA) data is public domain; no action needed.

## 6. Web Push keys (for alerts when the app is closed)
1. Run `npm run vapid:generate`.
2. Put the printed `VAPID_PUBLIC_KEY` into `worker/wrangler.toml` → `[vars] VAPID_PUBLIC_KEY`, and set
   `VAPID_SUBJECT = "mailto:<your support email>"` (push services contact this address if something goes wrong).
3. `npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml` and paste the private key.
   (Locally: both lines in `worker/.dev.vars`.) Never commit the private key; rotating it invalidates subscriptions.

## 7. Supabase (sign-in + subscription records)
1. Create a project at https://supabase.com/dashboard (region: Mumbai `ap-south-1` for India).
2. **SQL Editor** → paste and run `supabase/migrations/20261107000000_init.sql` (or `supabase db push` with the CLI).
3. **Authentication → Providers → Email:** enabled; under **Email templates → Magic Link** make sure the template
   includes `{{ .Token }}` so users get a 6-digit code (the app asks for the code). For production, set up custom SMTP
   (**Project Settings → Authentication → SMTP**) — Supabase's built-in sender is rate-limited.
4. **Authentication → URL Configuration:** Site URL = your Pages URL; add `http://localhost:5173` to Redirect URLs.
5. **Google sign-in:** in Google Cloud → APIs & Services → Credentials → *Create OAuth client ID* (Web application);
   Authorized redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`. Paste client id/secret into
   Supabase → Authentication → Providers → Google. (Configure the OAuth consent screen first.)
6. Values:
   - `.env.local`: `VITE_SUPABASE_URL=https://<ref>.supabase.co`, `VITE_SUPABASE_ANON_KEY=<anon / publishable key>`
   - `worker/wrangler.toml` `[vars]`: `SUPABASE_URL = "https://<ref>.supabase.co"`
   - Secrets: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml`
     (and `SUPABASE_JWT_SECRET` only if your project still uses the legacy HS256 JWT secret).

## 8. Razorpay — TEST MODE ONLY (do not go live yet)
1. Sign up at https://dashboard.razorpay.com/signup. Stay in **Test Mode** (toggle at the top of the dashboard).
2. **Subscriptions** must be enabled on the account (Dashboard → Subscriptions; request activation if prompted).
3. **Account & Settings → API Keys → Generate Test Key** → `rzp_test_...` + secret.
4. Put them in `worker/.dev.vars` (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) and run `npm run razorpay:plans`; copy
   the printed `RAZORPAY_PLAN_MONTHLY` / `RAZORPAY_PLAN_YEARLY` into `worker/wrangler.toml` `[vars]` together with
   `RAZORPAY_KEY_ID`, and set `PAYMENTS_ENABLED = "true"`.
5. Production Worker: `npx wrangler secret put RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`.
6. **Account & Settings → Webhooks → Add new webhook:** URL `https://<your-worker>/api/billing/webhook/razorpay`,
   secret = the same `RAZORPAY_WEBHOOK_SECRET`, events: `subscription.authenticated`, `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`,
   `subscription.completed`, `subscription.paused`, `subscription.resumed`.
7. Test with Razorpay's test cards / test UPI id `success@razorpay`.
8. **Before ever going live** (not now): KYC/activation, legal entity + GST, a refund policy page, a licensed flight data
   feed (community feeds are non-commercial), Open-Meteo commercial plan, and then live keys + `PAYMENTS_LIVE_ACK`.

## 9. Analytics (optional)
- Default needs nothing (first-party counters in D1). To read them: `npx wrangler secret put ADMIN_TOKEN` (any long
  random string), then `curl -H "Authorization: Bearer <token>" https://<worker>/api/admin/usage?days=30`.
- Plausible instead: `VITE_ANALYTICS=plausible`, `VITE_PLAUSIBLE_DOMAIN=<your domain>` (add the site at plausible.io).
- PostHog instead: `VITE_ANALYTICS=posthog`, `VITE_POSTHOG_KEY=phc_...`, `VITE_POSTHOG_HOST=https://eu.i.posthog.com`.

## 10. OpenSky Network (optional, more coverage)
1. Register at https://opensky-network.org/ (free account).
2. Account page → **API Client** → create a client → you get a `client_id` and `client_secret` (OAuth2 client
   credentials; basic auth is no longer accepted).
3. `npx wrangler secret put OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` (`--config worker/wrangler.toml`), or put
   them in `worker/.dev.vars`. Default budget assumes 4,000 credits/day (`OPENSKY_DAILY_CREDITS`); contributors who feed
   data get 8,000.

## 11. Legal (before public launch)
- `public/legal/privacy.html` and `terms.html` are **templates**. Fill the bracketed placeholders (legal entity,
  address, grievance officer, contact emails, refund policy, governing city) and have a lawyer review them (India DPDP
  Act 2023; GDPR if you serve EU users).
- Decide the code licence (README says "all rights reserved" until you choose).
- Airline names and approximate brand colours are used only to identify flights; no logos or liveries are shipped.

## 12. Licensed flight data (before charging money)
- adsb.lol, airplanes.live and OpenSky are **non-commercial**. Before `LAUNCH_MODE=freemium` with live payments, sign
  a commercial feed (e.g. FlightAware AeroAPI, Aviation Edge, ADS-B Exchange Enterprise, Spire, Cirium), implement it in
  `worker/src/providers/commercialStub.ts`, then set `PROVIDERS=commercial` (or `commercial,adsblol` during migration).
- Also check Cesium ion's commercial terms if you use ion layers in a paid product, and Google Maps Platform terms
  (attribution and caching rules are already respected: no tile caching, credits always visible).

## 13. Android app (later)
- Google Play developer account, then follow `docs/android-twa.md` (Bubblewrap, Digital Asset Links).
- **Decision needed:** Play's payments policy for in-app digital subscriptions (Play Billing vs. India user choice
  billing vs. selling only on the website). See the warning in `docs/android-twa.md`.

## 14. Domain
- Buy a domain, add it to the Pages project (Pages → Custom domains), add it to `ALLOWED_ORIGINS`, the Google API key
  referrer list, the Cesium ion token's allowed URLs, Supabase redirect URLs and the Razorpay webhook URL.

## 15. Satellite imagery key (before charging money)
- The satellite fallback layer uses Esri World Imagery, which works without a key for development and non-commercial
  use. For a paid product: create an ArcGIS Location Platform account (https://location.arcgis.com, free tier
  available) → *Developer credentials → API key* with the **Basemaps** privilege, restrict it to your domains, and set
  `VITE_ARCGIS_API_KEY`. Keep its attribution visible (already in the credit bar).
- 3D airport scenery comes from public Overpass API servers (cached 7 days). If you scale up, point `OVERPASS_URLS`
  at your own Overpass instance or a paid provider, and re-run `npm run data:airport3d` occasionally to refresh the
  curated airports.
