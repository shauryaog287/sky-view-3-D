# Progress

Legend: ✅ done · 🔄 in progress · ⏳ not started · ⛔ blocked (see NEEDS_FROM_ME.md)

| Milestone | Status | Notes |
| --- | --- | --- |
| M1 Scaffold, globe, fallback tiles, CI, tests | ✅ | Offline Natural Earth globe works with zero keys |
| M2 Backend, providers, caching, live aircraft | ✅ | Live adsb.lol data verified end-to-end through `wrangler dev`; airplanes.live ⛔ needs approval email |
| M3 Motion, models, cameras, info panel, search | ✅ | Chase / orbit / cockpit verified in headless Chromium (tablet + phone); adsbdb enrichment live |
| M4 Airports, phase detection, takeoff/landing, Google tiles | ✅ | Tower/runway cams verified on the scripted DEL 28 arrival. Google tiles path coded but ⛔ untested without a key |
| M5 Weather/sky, quality, performance | ✅ | Haze fog verified with live Delhi METAR (1.1 km HZ); clouds at METAR base; settings sheet |
| M6 Track storage, replay, alerts | ✅ | D1 track write/read + cron verified under `wrangler dev`; push crypto verified vs RFC 8291 |
| M7 Auth, feature flags, paywall (off), Razorpay test, analytics | ✅ | Paywall flow verified end-to-end in mock mode; JWT + Razorpay signatures/webhooks unit-tested |
| M8 PWA polish, legal, deploy, README | ✅ | Installable + offline shell verified by e2e; legal pages; deploy scripts + manual workflow; README |
| Real airports without a key | ✅ | Esri satellite layer + OSM 3D terminals/towers/jet bridges; tower cam in the real tower (D-028) |
| 3D airports, 2D city | ✅ | Google 3D tiles clipped to airport outlines, flat 2D satellite map elsewhere (default; "Everywhere" in Settings). Verified with a stand-in tileset (no Google key yet) (D-031) |
| Runway assignment + India-first rollout | ✅ | Runway in use learned live (lined up → traffic → wind → geometry), shown in the info panel and used by runway/tower cams; Indian international airports' 3D scenery shipped; airline-specific replica slots (D-030, docs/india-rollout.md) |
| Per-type aircraft models | ✅ | 53 generated models / 218 ICAO types, airline tail colours, gear retracts in flight; import script for licensed photoreal models (D-029) |

## Test status (last run)
- `npm run typecheck` — clean (web, worker, scripts).
- `npm test` — 28 files / 116 tests passing.
- `npm run test:e2e` — 20 tests (10 flows × tablet + phone) passing against the mock-mode production build.

## Not yet verified (needs keys, accounts or a real device)
- ⛔ Google Photorealistic 3D Tiles rendering, session caps against real Google billing, tile preloading, curated
  tower/runway camera positions over real photogrammetry (NEEDS_FROM_ME §3).
- ⛔ Cesium ion terrain/imagery layer (§4) and OpenSky provider against the real API (§10; unit-tested with fakes).
- ⛔ Real Web Push delivery to a phone (§6), Supabase sign-in (§7), Razorpay test checkout + webhooks (§8).
- ⛔ GPU frame rate on a mid-range Android device (CPU side measured: ~0.12 ms/frame for 200 aircraft).
- airplanes.live returns 403 until access is granted (§2).

## Known limitations / next steps
- Community ADS-B coverage over India is sparse (D-008); a licensed feed is the real fix (§12).
- The main JS chunk is ~4.2 MB (CesiumJS); fine for a cached PWA, but a lazy-loaded split would speed up first load.
- Cloud layer is an approximation (cumulus billboards), not volumetric weather.
- No CSP header yet (D-027).
