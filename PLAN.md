# SkyView 3D — Build Plan

Live flights in a photorealistic 3D world. Installable PWA first, Android (TWA) wrapper later.

This file is the roadmap. Live status is in [PROGRESS.md](PROGRESS.md), the reasoning behind
important choices is in [DECISIONS.md](DECISIONS.md), and everything that needs a human
(accounts, keys, payments, legal) is in [NEEDS_FROM_ME.md](NEEDS_FROM_ME.md).

## Architecture at a glance

```
 Browser / PWA (Cloudflare Pages)                     Cloudflare Workers (API)
 ┌───────────────────────────────────────┐           ┌──────────────────────────────────────┐
 │ Preact UI  (search, panels, sheets)   │  /api/*   │ Router (CORS, auth, entitlements)    │
 │ CesiumJS scene                        │ ────────▶ │  ├─ FlightHub Durable Object         │
 │  ├─ Google Photorealistic 3D Tiles    │           │  │   ├─ provider adapters + merge     │
 │  │   └─ fallback: ion terrain/imagery │           │  │   ├─ token buckets / 429 backoff   │
 │  │       └─ fallback: offline globe   │           │  │   ├─ bucketed region cache (3 s)   │
 │  ├─ aircraft LOD (billboards ↔ glTF)  │           │  │   └─ track recorder → D1           │
 │  ├─ motion smoother (60 fps)          │           │  ├─ enrichment (adsbdb) → KV cache    │
 │  ├─ cameras (chase/cockpit/orbit/     │           │  ├─ weather (METAR + Open-Meteo)      │
 │  │   tower/runway-end)                │           │  ├─ alerts + Web Push (cron)          │
 │  └─ sky: sun, fog, cloud layer        │           │  ├─ tiles session caps (D1 counters)  │
 │ Service worker (offline shell, push)  │           │  └─ billing: PaymentProvider          │
 └───────────────────────────────────────┘           │       └─ Razorpay (test mode)         │
              │ Supabase JS (auth only)               └──────────────────────────────────────┘
              ▼                                                    │ service role
        Supabase (auth, profiles, subscriptions) ◀─────────────────┘
```

The frontend never talks to flight data providers directly. Everything goes through `/api`.

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/` | Frontend (Vite + TypeScript + Preact + CesiumJS) |
| `src/config/features.ts` | Feature registry, tiers, `LAUNCH_MODE`, `canUse()` |
| `worker/` | Cloudflare Worker API, Durable Object, D1 migrations, `wrangler.toml` |
| `shared/` | Pure, framework-free logic used by both sides (types, geo, phase detection, merge, simulator) |
| `scripts/` | Build-time tools (airports dataset, aircraft models, icons, fixtures, VAPID keys, Razorpay plans) |
| `data/` | Generated compact datasets (airports + runways JSON) |
| `fixtures/` | Recorded real-looking ADS-B JSON used for mocks and tests |
| `public/` | Static assets: aircraft glTF models, icons, manifest, legal pages |
| `supabase/` | SQL migrations for profiles and subscriptions |
| `tests/e2e/` | Playwright smoke tests |

## Milestones

### M1 — Scaffold, globe, fallback tiles, CI, tests
- Vite + TS + Preact + Cesium wired up (static Cesium assets copied, `CESIUM_BASE_URL`).
- Globe with layered fallback: Google 3D Tiles → Cesium ion World Terrain + imagery → offline Natural Earth globe.
- Attribution always visible.
- Vitest + Playwright configured; GitHub Actions CI (typecheck, unit tests, build, smoke).
- `.env.example`, docs skeletons.

### M2 — Backend, providers, caching, live aircraft
- `ProviderAdapter` interface: `AdsbLolProvider`, `AirplanesLiveProvider`, `OpenSkyProvider` (OAuth2 client credentials), `CommercialProviderStub`, `FixtureProvider`.
- Normalisation to one `AircraftState` shape; merge by ICAO hex, freshest position wins.
- Region buckets (grid cells), 3 s shared cache, in-flight coalescing, token bucket per provider, 429 backoff.
- `FlightHub` Durable Object; Worker router with CORS.
- Recorded fixtures + browser-side mock API so every screen works without a backend.
- Aircraft on the globe (billboards), polling loop.

### M3 — Smooth motion, models, cameras, info panel, search
- Dead reckoning + projective velocity blending (~1 s) at 60 fps; bank from turn rate, pitch from vertical rate.
- Procedurally generated CC0 glTF aircraft models per class; ICAO type → class mapping.
- LOD: billboards far, glTF near (count capped by quality).
- Follow cameras: chase, cockpit, free orbit. Info panel with data-age indicator. Search by flight no / callsign / reg / hex.
- Route + aircraft enrichment (adsbdb) with long caching.

### M4 — Airports, phase detection, takeoff/landing, Google 3D Tiles
- OurAirports → compact JSON at build time (thresholds, headings, elevations).
- Phase detection: ground / takeoff roll / climb / cruise / descent / approach / landing.
- Camera presets: tower, runway-end, chase; curated presets for DEL BOM BLR MAA CCU HYD RPR + 5 hubs, auto-generated elsewhere.
- Preload tiles around destination when a followed flight starts descending.
- Google tiles session caps (per user/day + global/day) with fallback when capped.

### M5 — Weather, sky, quality, performance
- METAR (aviationweather.gov) + Open-Meteo (clouds/visibility) via backend with caching.
- Real-time sun lighting, day/night tint on photoreal tiles, distance fog from visibility, cloud layer at reported bases.
- Quality Low/Med/High (resolution scale, SSE, model count, clouds, shadows, fps cap).

### M6 — Track storage, replay, alerts
- Track points (hex, ts, lat, lon, alt, gs, track, vrate) written to D1, 2 h rolling window (cron prune).
- Replay last ~60 min with cubic Hermite interpolation, scrubber and speeds.
- Alerts (“tell me when 6E-2134 starts descending into DEL”) evaluated by cron; Web Push (VAPID, RFC 8291) + in-app fallback.

### M7 — Auth, feature flags, paywall (off), Razorpay test mode, analytics
- Supabase auth (email OTP + Google). JWT verification in the Worker (JWKS or HS256).
- `canUse(id)` / `useFeature(id)` everywhere; upsell sheet for locked features; `LAUNCH_MODE=open` by default.
- `PaymentProvider` interface; Razorpay subscriptions (test mode), webhook signature verification, entitlement endpoint; Stripe stub.
- Account screen: plan, renewal date, cancel.
- Privacy-friendly per-feature analytics (first-party counters; optional Plausible/PostHog).

### M8 — PWA polish, legal, deploy, README
- Manifest, icons, offline shell, install prompt. Lighthouse-installable.
- Privacy Policy, Terms, Data Sources & Attribution pages.
- Deploy scripts for Pages + Workers + D1 + KV; README with run/deploy steps.

## Test plan (minimum)
- Unit: provider parsing + merge, token bucket, buckets, interpolation, Hermite replay, phase detection,
  entitlement checks, Razorpay signatures, Web Push encryption (RFC 8291 vector), tile caps, search normalisation.
- E2E smoke (Playwright, mock API): globe loads, aircraft appear, search → info panel → follow, replay opens,
  account + legal pages render, locked-feature upsell in freemium mode.

## Hard rules
- No live payments. No scraping Flightradar24/FlightAware. Never remove data attributions. Never commit secrets.
