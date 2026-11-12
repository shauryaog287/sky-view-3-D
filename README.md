# SkyView 3D

Live flights in a photorealistic 3D world. Follow any aircraft with a chase, orbit or cockpit camera, watch takeoffs and
landings from the tower or the runway end, see the real sky (sun, haze, clouds), replay the last hour of a flight and
get alerts when a flight starts descending. Installable PWA; Android (TWA) later.

> Built mobile-first for Android tablets and phones. Works with **zero keys** in mock mode.

![Architecture](https://img.shields.io/badge/frontend-Vite%20%2B%20Preact%20%2B%20CesiumJS-39d0ff) ![API](https://img.shields.io/badge/API-Cloudflare%20Workers%20%2B%20D1%20%2B%20Durable%20Objects-f38020)

## Quick start (no accounts, no keys)

```bash
npm ci
npm run dev:mock          # http://localhost:5173 — recorded real ADS-B data + scripted takeoffs/landings
```

Mock mode runs an in-browser simulator built from recorded real ADS-B snapshots plus five scripted flights on real
runways (search **SKV101** – arrival into Delhi 28, **SKV202** – departure from Mumbai 27, **SKV303** BLR, **SKV404**
Raipur, **SKV505** HYD). Every screen works: search, info panel, all cameras, weather, replay, alerts, account and the
(test) paywall. Settings → *Demo: simulate freemium* shows the paywall switched on.

## Running with live data locally

```bash
cp worker/.dev.vars.example worker/.dev.vars     # optional keys; empty = feature off
npm run db:migrate:local                         # local D1 (tracks, alerts, counters)
npm run dev:api                                  # Worker on http://127.0.0.1:8787 (live adsb.lol data)
npm run dev                                      # frontend on http://localhost:5173 (proxies /api → 8787)
```

`PROVIDERS=fixture` in `worker/.dev.vars` serves recorded data from the Worker instead (offline development).

## What's inside

| Area | Where | Notes |
| --- | --- | --- |
| Feature flags & paywall | `src/config/features.ts` | `canUse(id)` everywhere; `LAUNCH_MODE` (Worker var) = `open` today |
| Plans (INR) | `src/config/plans.ts` | Pro Monthly ₹149, Pro Yearly ₹1,299 (placeholders) |
| Live data providers | `worker/src/providers/` | adsb.lol, airplanes.live, OpenSky (OAuth2), commercial stub, fixtures |
| Shared cache / rate limits | `worker/src/flights/flightService.ts` | grid buckets, 3 s cache, token buckets, 429 backoff, merge by hex |
| Smooth motion | `src/motion/smoother.ts` | dead reckoning + projective velocity blending (see DECISIONS D-010) |
| Phase detection | `shared/phase.ts` | ground → takeoff roll → climb → cruise → descent → approach → landing |
| Runway assignment | `shared/runwayUsage.ts` | lined up → runway in use (learned from traffic) → wind → geometry |
| Cameras | `src/scene/cameras.ts`, `shared/airportPresets.ts` | chase, orbit, cockpit, tower, runway-end |
| Base layers | `src/scene/baseLayers.ts`, `src/scene/photorealScope.ts` | Google 3D Tiles (default: only at airports, flat 2D satellite map around) → Cesium ion → satellite → offline globe, with session caps |
| Weather & sky | `src/scene/sky.ts`, `worker/src/routes/weather.ts` | sun tint, visibility fog, cloud layer from METAR / Open-Meteo |
| Replay | `src/motion/hermite.ts`, `src/scene/replay.ts` | 60 min from D1 track points |
| Alerts | `shared/alertRules.ts`, `worker/src/alerts/`, `worker/src/push/webpush.ts` | cron + Web Push (RFC 8291) |
| Auth & billing | `worker/src/auth.ts`, `worker/src/billing/` | Supabase JWT, Razorpay (test mode only), Stripe stub |
| 3D terrain | `src/scene/openTerrain.ts`, `shared/terrainFlatten.ts` | open elevation tiles, airports flattened to field elevation |
| Airport scenery | `shared/airportMesh.ts`, `shared/airportLights.ts`, `src/scene/airport3dLayer.ts` | procedural architecture + airfield lighting from OpenStreetMap; 256 airports pre-built (`npm run data:airport3d -- --all`) |
| Airline paint, aircraft lights | `shared/liveries.ts`, `src/scene/modelPool.ts`, `src/scene/aircraftLights.ts` | colour schemes per airline (no logos), strobes, beacons, landing lights |
| Aircraft models | `scripts/build-models.ts` → `public/models/types/*.glb`, `shared/aircraftModels.json` | one model per ICAO type (53), airline paint schemes, retracting gear; `npm run models:import` adds downloaded or bought models (auto-detects orientation, paint zones and landing gear; 10 CC-BY models in `public/models/licensed/`) |

Docs: [PLAN.md](PLAN.md) · [PROGRESS.md](PROGRESS.md) · [DECISIONS.md](DECISIONS.md) ·
[NEEDS_FROM_ME.md](NEEDS_FROM_ME.md) · [ASSETS_LICENSES.md](ASSETS_LICENSES.md) · [docs/android-twa.md](docs/android-twa.md)

## Tests

```bash
npm run typecheck     # web, worker and scripts
npm test              # Vitest: providers & merge, buckets, token bucket, interpolation, Hermite replay, phase
                      # detection, alerts, entitlements, JWT, Razorpay signatures/webhooks, Web Push (RFC 8291 vector), …
npm run test:e2e      # Playwright smoke (mock-mode production build, tablet + phone viewports)
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push.

## Deploy (Cloudflare)

One-time setup (details and exact clicks in [NEEDS_FROM_ME.md](NEEDS_FROM_ME.md) §1):

```bash
npx wrangler login
npx wrangler d1 create skyview                 # paste database_id into worker/wrangler.toml
npm run db:migrate:remote
npx wrangler pages project create skyview-3d --production-branch main
# secrets (only the ones you use):
npx wrangler secret put GOOGLE_MAPS_API_KEY --config worker/wrangler.toml
npx wrangler secret put OPENSKY_CLIENT_ID --config worker/wrangler.toml   # …and OPENSKY_CLIENT_SECRET, etc.
```

Every deploy:

```bash
npm run deploy:api                             # Worker → https://skyview-api.<you>.workers.dev
echo "VITE_API_BASE=https://skyview-api.<you>.workers.dev" > .env.production.local
npm run deploy:web                             # builds and uploads to Cloudflare Pages
```

Add your Pages domain to `ALLOWED_ORIGINS` in `worker/wrangler.toml`. There is also a manual GitHub Actions workflow
(`.github/workflows/deploy.yml`) that does the same with `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets.

### Turning the paywall on later
1. Finish NEEDS_FROM_ME §7–8 (Supabase, Razorpay) and the "before going live" list (licensed flight data feed etc.).
2. In `worker/wrangler.toml`: `LAUNCH_MODE = "freemium"` (optionally adjust `FEATURE_TIERS`), `PAYMENTS_ENABLED = "true"`.
3. `npm run deploy:api`. No frontend change is needed.

## Things to check on a real device

These need real hardware / real keys and could not be verified in headless CI:

1. **Performance on a mid-range Android tablet** – zoom into a busy area (Delhi/Mumbai at peak, or Dubai/London) with
   Medium quality; aim for 60 fps with ~200 aircraft (Chrome DevTools → Rendering → FPS meter via USB debugging). Try
   Low for battery and High for looks.
2. **Photorealistic airports** – with a Google key, follow an arrival into DEL/BOM/BLR and switch to Tower and Runway
   cameras: does the aircraft touch down on the runway surface, and are the curated camera positions sensible
   (`shared/airportPresets.ts` holds the numbers)?
3. **Smoothness while following** – chase a real flight for a few minutes: no jumps when updates arrive, banking in
   turns, data-age chip turning amber when updates pause.
4. **Install + offline + push** – install from Chrome's menu, enable an alert with push, close the app and wait for it
   to fire; open the installed app in airplane mode (shell and globe should load, with an offline banner).
5. **Sign-in and test checkout** – email code and Google sign-in, then a Razorpay test subscription (`success@razorpay`
   UPI or a test card), cancel it, and check the Account screen dates (with `LAUNCH_MODE=freemium` on a staging Worker).

## Licences
Code: all rights reserved by the owner unless a licence is added. Data and asset licences: [ASSETS_LICENSES.md](ASSETS_LICENSES.md)
and the in-app *Data sources & attribution* page. Community flight data is non-commercial; see NEEDS_FROM_ME before charging.
