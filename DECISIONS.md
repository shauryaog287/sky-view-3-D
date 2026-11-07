# Decisions

Short architecture decision records. Newest decisions are appended at the bottom of each section.

## D-001 · One package, three source roots (`src/`, `worker/`, `shared/`)
- **Context:** Frontend (Vite) and backend (Workers) share types and pure logic (phase detection, geo, feature tiers).
- **Decision:** A single `package.json` with `src/` (web), `worker/` (API) and `shared/` (framework-free logic, no DOM and no
  Workers globals). `src/config/features.ts` and `src/config/plans.ts` are also pure so the Worker imports them directly.
- **Why:** One install, one Vitest run over everything, no workspace tooling. Wrangler bundles the Worker with esbuild,
  so relative imports into `shared/` just work.

## D-002 · Pinned, slightly-behind dependency versions
- Every dependency is pinned to an exact version that was at least ~2 weeks old at the time of writing (supply-chain hygiene).
- `cesium@1.146.0` declares `@cesium/engine@^26.4.0`, but `26.5.0` (shipped with 1.147) removed exports that 1.146 re-exports,
  which breaks bundling. `package.json#overrides` pins `@cesium/engine@26.4.0` and `@cesium/widgets@16.3.0`. Remove the
  override when upgrading Cesium.
- `.npmrc` sets `legacy-peer-deps=true`: npm 10 crashes (`edgesOut` of null) resolving vitest 5's optional peer graph.
- Playwright is pinned to `1.63.0` to match the Chromium build preinstalled in the dev container; CI installs its own.

## D-003 · Preact + signals for UI
- Small (~4 kB) and fast on mid-range Android. Signals keep re-renders local. High-frequency data (aircraft positions, 60 fps)
  never goes through UI state; the Cesium layer reads it directly.

## D-004 · Base-layer fallback chain
1. **Google Photorealistic 3D Tiles** (`createGooglePhotorealistic3DTileset`) – direct Map Tiles API key, or streamed through
   Cesium ion when only an ion token is configured.
2. **Cesium World Terrain + ion world imagery** – when Google is missing, capped, or failing (quota/403/429 tile errors).
3. **Offline Natural Earth II globe** bundled with Cesium – needs no key and no network, so the app always renders.
- The globe is hidden while Google tiles are active (they cover the whole planet; avoids z-fighting, saves GPU).
- The Google tileset is created once per page load (= one billable root session) and only shown/hidden afterwards.
- We ship **no place geocoder**, which satisfies Google's “only the Google geocoder with these tiles” rule
  (`onlyUsingWithGoogleGeocoder: true`). If place search is added later it must use the Google geocoder.
- Cesium's credit bar is restyled but never hidden; it sits above every panel (`z-index: 50`).

## D-005 · Headless WebGL in tests
- Playwright runs Chromium with `--enable-unsafe-swiftshader` so Cesium can render with software WebGL in CI.
  The smoke suite runs against the **mock-mode production build** (`vite build --mode mock`) so it needs no backend or keys.

## D-006 · One singleton Durable Object (`FlightHub`) owns all upstream calls
- **Problem:** "share one upstream call across all users" + "respect every provider's rate limit" need global state.
  Workers isolates are per-colo and short-lived; KV is eventually consistent with a 60 s minimum TTL (useless for 3 s caching)
  and has a 1,000 writes/day free limit.
- **Decision:** a single `FlightHub` Durable Object (`idFromName('global')`) holds the bucket cache, the per-provider
  token buckets and backoff state, and the track recorder. All `/api/aircraft|search|status` requests are forwarded to it.
- **Trade-off:** one location serves every request (extra latency for far-away users, ~1k req/s ceiling per DO). Fine for
  launch; the upstream limits (~1 req/s per provider) are the real bottleneck. Shard by region (`idFromName(regionKey)`)
  with per-shard token budgets if traffic outgrows it.

## D-007 · Region buckets, 3 s shared cache, coalescing, "wait briefly then serve stale"
- Views are mapped onto a fixed grid (2° cells, 6° when zoomed out; at most 9/12 buckets, nearest the view centre first).
  Identical cells across users → identical upstream queries → one cache entry.
- Each bucket is refreshed at most once per `CACHE_TTL_MS` (3 s default). Concurrent requests await the same in-flight
  promise. If a refresh needs to wait for a token, a request waits up to 1.5 s and then gets the older data with
  `stale: true` (the client keeps dead-reckoning, so the map never freezes).
- All providers that have a token are queried in parallel and merged by ICAO hex (freshest position wins; missing fields
  such as registration are filled from the other report). If they all fail, the next usable provider is tried once.
- 429 → backoff (Retry-After honoured, else 5 s doubling to 60 s). 401/403 → 10 min (e.g. airplanes.live without approval).

## D-008 · Providers and licensing
- Order: `adsblol,airplaneslive,opensky` (config `PROVIDERS`). OpenSky is skipped unless OAuth2 client credentials exist.
- **All three free feeds are non-commercial only.** `CommercialProviderStub` exists so that switching to a licensed
  feed is `PROVIDERS=commercial` + vendor key. Each adapter declares `commercialUseAllowed`; `/api/config` exposes it.
- **airplanes.live now returns 403 for unregistered clients** ("Please contact us…"), so it is effectively off until you
  email them (see NEEDS_FROM_ME). The backoff makes the 403 cost one request per 10 minutes.
- Coverage note: community ADS-B coverage over India is thin (e.g. 7 aircraft within 60 NM of DEL in the recorded
  sample at 09:50 IST). OpenSky helps a bit; a commercial feed is the real fix for an India-first product.

## D-009 · Mock mode and fixtures
- `npm run dev:mock` (or `?mock=1`) swaps the HTTP client for `MockApiClient`, which runs the same simulator the Worker's
  `FixtureProvider` uses: recorded real snapshots (adsb.lol, ODbL) flown on by dead reckoning, plus five scripted
  arrivals/departures on real runway geometry (DEL 28, BOM 27, BLR 09L, RPR 24, HYD 27R) with fictional `SKV` callsigns.
  Every endpoint (search, info, weather, replay, alerts, entitlements, checkout) has a mock implementation, so every
  screen works with no keys and no network. Playwright runs against this build.

## D-010 · Live smoothing: custom dead reckoning + projective velocity blending (not SampledPositionProperty)
- `SampledPositionProperty` + Hermite needs samples on *both sides* of the render time. For live data that means
  rendering one update interval (up to 10 s) in the past, or extrapolating — and Cesium's extrapolation is linear/hold,
  while Hermite on sparse, irregular, noisy samples overshoots at every turn.
- **Choice:** `src/motion/smoother.ts`. Each fix becomes a kinematic state (position, ground speed, track, turn rate,
  vertical rate). Frames extrapolate along a constant-turn arc (turns continued ≤ 12 s, climbs ≤ 30 s, everything frozen
  after 60 s). A new fix starts a 1 s smoothstep blend between the old and new extrapolations, both evaluated at the
  current frame time (projective velocity blending, as used in networked games). Position and velocity stay continuous
  — no teleports — and the aircraft is shown "now", not 10 s late. Turn rate / vertical rate are estimated from
  consecutive fixes when the feed lacks them; bank = atan(v·ω/g), pitch = flight-path angle + 2.5° AoA bias.
- Replay uses all-known samples, so it uses cubic Hermite interpolation instead (M6).
- Server timestamps are converted to the client clock with a smoothed server-offset estimate.

## D-011 · Aircraft models are generated, not downloaded
- `scripts/build-models.ts` builds 8 low-poly glTF models (narrowbody, widebody, regional, turboprop, bizjet, helicopter,
  light, generic) from parametric parts: lathed fuselage, tapered diamond-section wings, nacelles, T-tails, prop/rotor
  discs, landing gear. 14–27 KB each, 280–760 triangles — cheap enough for 40 on screen on a mid-range phone.
- **Why:** licence certainty (original work, CC0) and zero third-party download dependency. Higher-detail CC-BY models
  can replace them later by dropping `.glb` files with the same names (record them in ASSETS_LICENSES.md and credit
  them on the Data Sources page).
- glTF axes: +Y up, +Z nose. Cesium maps glTF +Z forward to model +X; the model matrix is built explicitly from the
  local ENU frame (`src/scene/orientation.ts`, unit-tested) rather than relying on HeadingPitchRoll conventions.
- Airline tint: a 22 % colour MIX from `shared/airlines.ts` brand colours (approximate colours, no logos or liveries).

## D-012 · LOD
- Every aircraft is a billboard (heading-rotated silhouette, `alignedAxis = UNIT_Z` so "up" points to true north).
- The nearest N aircraft within 35 km (N by quality: 6/16/40) plus the selected/followed one (up to 400 km) get a glTF
  model; models are pooled per class and recycled, never destroyed while panning. `minimumPixelSize` keeps a model at
  least as visible as the billboard it replaces, so the swap is not noticeable.

## D-013 · Caching for enrichment: Cache API + in-isolate LRU, no KV
- adsbdb airframe lookups are cached 7 days, routes 6 h, unknowns 1 h. Cloudflare's Cache API has no write quota;
  free-tier KV allows only 1,000 writes/day, which a popular map would exhaust in minutes. The KV binding was removed
  (one less resource to create). Durable Objects + Cache API cover every caching need.
- Photos from adsbdb (airport-data.com) are not shown: their licence is unclear.

## D-014 · Follow cameras
- Chase: `lookAtTransform(ENU(aircraft), HeadingPitchRange(smoothed track, −9° + 0.4·pitch, range))` every frame,
  heading low-pass filtered (τ ≈ 0.6 s); pinch-zoom changes the range. Orbit: re-anchors the user's current offset on
  the moving aircraft every frame. Cockpit: eye at the nose from the same model matrix, the aircraft's own model hidden.
- Entering a follow mode flies to where the aircraft *will be* when the flight ends (motion prediction), so there is no
  snap at the end. `prefers-reduced-motion` skips the flight.
- Feed polling is debounced and never aborted by camera movement (follow cameras move every frame).

## D-015 · Phase detection
- `shared/phase.ts` (pure; used by the browser and by the Worker's alert cron). Inputs: pressure altitude relative to
  the best-matching runway's elevation, vertical rate, ground speed + its trend, and alignment with the runway
  (heading within 25°, inside a cone that widens 12 % with distance, up to 15 NM out).
- Rules: on ground + on runway + ≥ 35 kt → takeoff roll (accelerating / came from ground) or landing (decelerating /
  came from approach); aligned + descending + < 6,000 ft AGL → approach; aligned + < 200 ft → landing; low, descending
  and < 9 NM from a field without alignment → approach (circling); otherwise climb/descent/cruise by vertical rate.
- 2.5 s debounce (hysteresis) except for takeoff roll / landing, which are short and strongly signalled.
- Verified against the five scripted demo flights (unit tests) — each yields the exact expected sequence and runway.

## D-016 · Render heights near airports
- ADS-B pressure altitude ≈ MSL, while Cesium draws ellipsoid heights and every base layer has its own surface.
- We sample the *rendered* surface at each airport's runway ends (`sampleHeightMostDetailed` on Google tiles,
  `sampleTerrainMostDetailed` on ion terrain, 0 on the offline ellipsoid) and derive a per-airport offset
  (`ground − field elevation` + QNH correction from METAR). Render height = pressure altitude + offset of the aircraft's
  reference airport, blended over ~2 s when the reference changes. Aircraft therefore touch down on the drawn runway on
  every layer. Away from airports the last offset is kept (error irrelevant at altitude).
- Sampling on Google tiles forces the tiles around those points to load: this *is* the "pre-load tiles around the
  destination airport when a followed flight starts descending" mechanism (destination from the route, else the runway
  the flight is lined up with).

## D-017 · Tower / runway-end cameras
- Viewpoints are defined relative to runway geometry (`shared/airportPresets.ts`), not hard-coded coordinates:
  tower = beside the runway in use (side, offset, along-fraction, height); runway-end = under the approach path before
  the threshold for arrivals, beside the rotation point for departures. 12 curated airports (DEL BOM BLR MAA CCU HYD
  RPR + DXB LHR SIN JFK FRA) have tuned values; every other airport gets the defaults (tower on the terminal side, which
  is inferred from the airport reference point). **Curated values were tuned against runway geometry, not visually
  against Google tiles** — check them on device and tweak the numbers in that file.
- The camera is lifted above any building the photoreal tiles have at that spot, and zooms (FOV 10–60°) to keep the
  aircraft framed. Silhouette outlines are disabled there (Cesium's silhouette pass rings at narrow FOV).

## D-018 · Google tiles cost guardrails
- `POST /api/tiles/session` is called once per page load, before the tileset is created; the tileset then lives for the
  whole session (one billable root request). Counters in D1 (`quota_counters`): per user/device (default 20/day),
  per IP (3× that, so minting device ids does not help), and a global daily budget (default 3,000). Over any cap the
  client uses ion terrain or the offline globe. All three are Worker vars.
- In `freemium` mode photoreal tiles are part of the Pro "airport views" feature; free users get the cheaper layer.
- The Google key is handed to the browser (Map Tiles keys are browser keys); protect it with HTTP-referrer and API
  restrictions plus a hard daily quota in Google Cloud (see NEEDS_FROM_ME). The Worker can also hand out the public
  Cesium ion token so the frontend build needs no tokens at all.
- Without photoreal tiles, runways and airport codes are drawn as overlays so takeoffs/landings still read clearly.

## D-019 · Weather & sky
- `/api/weather`: Open-Meteo current conditions (cloud cover by level, visibility, wind) on a 0.25° grid + the nearest
  METAR (aviationweather.gov bbox query on a 0.5° cell), both cached 10 min (Cache API). A METAR within 40 km overrides
  the model's visibility. Only fetched for the followed/selected aircraft (or a low camera), ≤ every 10 min / 25 km.
- **Sun:** Cesium lighting follows the real clock. Photoreal tiles have baked daylight, so a CustomShader multiplies
  them by a brightness + tint from solar elevation (day → golden hour → twilight → night; `shared/sun.ts`, tested).
- **Visibility:** a depth-based post-process fog (Cesium's built-in fog only helps distant globe tiles). Density
  = 3 / visibility (≈ 5 % contrast at the reported visibility), fading out as the camera climbs above ~1–4.5 km AGL.
  Haze/smoke (HZ, FU, DU) is tinted brown, mist grey-blue, and fog darkens at night. Note: with Cesium's logarithmic
  depth buffer the shader must decode the raw log depth itself (`czm_windowToEyeCoordinates` expects raw log depth);
  feeding it `czm_readDepth` output double-decodes and over-fogs everything.
- **Clouds:** Cesium `CloudCollection` cumulus billboards at the METAR cloud base (≤ 2 layers; FEW/SCT/BKN/OVC → 20/45/75/100 %
  of the quality budget) within 14 km of the followed aircraft, placed with a seeded PRNG so the field is stable.
  Falls back to Open-Meteo low/mid cloud cover. It is an approximation, not a cloud simulation.
- METAR QNH feeds the altitude correction near the reporting airport (pressure altitude ≠ true altitude).

## D-020 · Quality presets & performance
- Low / Medium / High (`src/config/quality.ts`): resolution scale and a device-pixel-ratio cap (phones report DPR 3+;
  rendering a map at 3× is wasted GPU), tiles/globe screen-space error, tile cache size, 3D-model count and distance,
  cloud budget, fog, shadows, FXAA and target FPS (30 on Low for battery). Default: Low on ≤ 4 cores / ≤ 3 GB RAM,
  Medium otherwise. High is a Pro feature (falls back to Medium when locked).
- Per-frame CPU for 200 aircraft (motion sampling) measured at ~0.12 ms (`src/motion/perf.test.ts`); LOD re-selection
  runs at 4 Hz instead of every frame; billboards for everything else. Real-device GPU profiling is still needed
  (see the device test list in README).

## D-021 · Track storage & replay
- The FlightHub's `TrackRecorder` turns polled data into sparse points (≥ 15 s apart on steady courses, ≥ 4 s in turns
  / climbs), buffers them in memory and writes them to D1 in multi-row INSERT batches every 30 s (DO alarm) or just
  before a replay read. Cron prunes points older than `TRACK_RETENTION_MIN` (120). Only flights inside areas someone
  is viewing are recorded — that is what the free feeds give us anyway. Rough cost: 300 visible aircraft ≈ 70k rows/h
  at peak; D1 free tier is 100k writes/day, so expect the paid Workers plan ($5/mo, 50M writes) once traffic grows.
- Replay uses cubic Hermite splines with recorded velocity tangents (Catmull-Rom fallback, linear across gaps > 2 min),
  injected as a pinned pseudo-aircraft so models, heights, phases and cameras all work unchanged.

## D-022 · Alerts & Web Push
- Conditions: takes off · starts descending · on approach · lands, optional airport filter (destination from route
  enrichment or the runway the flight is lined up with). One-shot, expire after 24 h, 10 active per device.
- Evaluated by the Worker cron every minute with the same `detectPhase` as the client (phase memory stored on the alert
  row). "Lands" fires at touchdown (landing roll on the ground) because many aircraft stop transmitting soon after.
- Web Push is implemented with WebCrypto (RFC 8291 aes128gcm + RFC 8292 VAPID/ES256); verified byte-for-byte against the
  RFC 8291 test vector. Expired subscriptions (404/410) are dropped.
- Without push (mock mode, no VAPID keys, permission denied, iOS Safari outside an installed PWA) alerts are evaluated
  in-app while SkyView is open: toast + local notification, and the alert is then deleted server-side so nothing fires
  twice.

## D-023 · Feature flags & the off-by-default paywall
- `src/config/features.ts` is the single registry: 14 features, each `free | pro`; `canUse(id, ctx)` is the only gate,
  pure, and used by both the browser (`useFeature(id)` / `canUseFeature`) and the Worker (`requireFeature` → HTTP 402).
- `LAUNCH_MODE` lives in the Worker (`wrangler.toml`), served via `/api/config`; the frontend only uses
  `VITE_LAUNCH_MODE` until that answers. Turning the paywall on = set `LAUNCH_MODE = "freemium"` and deploy the Worker.
  `FEATURE_TIERS` (JSON) moves individual features between tiers without code changes.
- Locked features show a 🔒 and open the upsell sheet (with plan prices), never a broken screen. In freemium, free
  users get the ion/offline layer instead of billed Google tiles; High quality falls back to Medium.
- Mock mode has a "simulate freemium" switch (Settings) and a fake checkout so the whole paywall can be demoed.

## D-024 · Auth: Supabase, verified in the Worker
- Browser: `@supabase/supabase-js` (lazy-loaded only when a session exists or the user signs in) with email OTP (6-digit
  code) and Google OAuth (PKCE). The access token is sent as `Authorization: Bearer` to our API.
- Worker: `jose` verifies the JWT against the project's JWKS (new asymmetric signing keys) with the legacy HS256 JWT
  secret as a fallback; audience `authenticated`, issuer `<SUPABASE_URL>/auth/v1`, anonymous users rejected.
- Supabase stores profiles and subscriptions (RLS: users read their own rows; only the Worker's service-role key writes).

## D-025 · Payments: PaymentProvider interface, Razorpay in TEST mode only
- `worker/src/billing/types.ts` defines the provider interface; `RazorpayProvider` implements Razorpay Subscriptions
  (UPI autopay/cards/e-mandate), `StripeProviderStub` reserves the slot. Routes and entitlements are provider-agnostic.
- Flow: `POST /api/billing/checkout` creates a Razorpay subscription with `notes.user_id` → browser opens Razorpay
  Checkout → handler response verified (`HMAC(payment_id|subscription_id, key_secret)`) → status stored in Supabase →
  webhooks (`X-Razorpay-Signature` = HMAC of the raw body) keep it in sync; event ids are recorded for idempotency.
- Pro access: `active`, `authenticated`, `pending` (grace while Razorpay retries), or `cancelled` until the paid
  period ends. Cancel = `cancel_at_cycle_end`.
- **Guardrails:** checkout is off unless `PAYMENTS_ENABLED="true"`; the provider refuses any key that does not start
  with `rzp_test_` unless `PAYMENTS_LIVE_ACK="I_UNDERSTAND_THIS_CHARGES_REAL_MONEY"`. Nothing in this repo goes live.

## D-026 · Analytics
- Default: first-party, aggregated, anonymous. The browser counts `feature × {use, locked, upsell_click}` and posts
  totals every minute / on tab hide to `/api/events`; the Worker adds them to daily rows in D1. No cookies, no ids,
  no IPs. `GET /api/admin/usage?days=30` (Bearer `ADMIN_TOKEN`) shows what people actually use — the data for deciding
  what to lock later. Plausible or PostHog can be switched on via `VITE_ANALYTICS`. Opt-out toggle, DNT and GPC respected.

## D-027 · PWA, hosting and deploy
- `vite-plugin-pwa` in injectManifest mode with our own `src/sw.ts`: precaches the built shell (incl. the ~4 MB
  Cesium chunk, models, airports, legal pages), caches Cesium's static assets on first use, and never caches `/api/*`.
  Verified by e2e: the page is SW-controlled and reloads offline. (Lighthouse removed its PWA category in v12, so
  installability is checked directly: manifest fields, 192/512/maskable icons, SW control, offline reload.)
- Frontend on Cloudflare Pages, API on a separate Worker. The frontend calls the Worker URL (`VITE_API_BASE`) with
  CORS (`ALLOWED_ORIGINS`) rather than a Pages Function proxy: fewer moving parts. Put both behind one custom domain
  later (Worker route `/api/*`) to drop CORS entirely.
- `public/_headers` sets security headers and immutable caching for hashed assets. No CSP yet: Cesium workers, Google
  tiles, Cesium ion, Razorpay Checkout and Supabase each need allowances — add one once the domains are final.
- Data attributions are injected into Cesium's credit bar (`src/scene/credits.ts`), so they sit with the Google/ion
  credits and are never covered by UI. Legal pages are plain HTML under `/legal/` (work without JS; Play Store needs a
  privacy-policy URL) and are also shown in-app.

## D-028 · "Exact airport" without a Google key: satellite imagery + OpenStreetMap 3D scenery
- **Truly photoreal airports come from Google Photorealistic 3D Tiles** (already integrated; needs the key in
  NEEDS_FROM_ME §3). Without it the old fallback was a 3 km/pixel Natural Earth globe — "grass, sky and a runway".
- New layer between Cesium ion and offline: **Esri World Imagery** (`ArcGisMapServerImageryProvider`, keyless for
  development/non-commercial use; `VITE_ARCGIS_API_KEY` for production/commercial). Sub-metre imagery at major airports:
  real runways, taxiways, aprons, terminal roofs and parked aircraft. Layered above the offline globe, so failed tiles
  degrade gracefully. Attribution is added to the credit bar.
- **3D scenery from OpenStreetMap** (`shared/airport3d.ts`): terminals, hangars, other airport buildings, canopies,
  elevated jet bridges and control towers (shaft + glass cab), extruded with tagged heights / levels / per-kind
  defaults; aprons and taxiways are drawn only on the offline globe (imagery already shows them). The 12 curated
  airports ship as static files (`npm run data:airport3d`, 25–200 KB each); any other airport is built on demand by
  `GET /api/airport3d/:icao` (Overpass → cached 7 days). OSM levels on control towers usually count only the cab, so
  untagged towers use the curated tower height (≈ public figures: DEL ~100 m, LHR 87 m, JFK 98 m…) or 50 m.
- The **tower camera now stands in the real control tower** (OSM position) when the scenery is loaded. On imagery
  layers its narrowest field of view is 34° (flat imagery smears when zoomed at grazing angles); 10° with Google tiles.
- Painted runway strips are only drawn on the offline globe; with imagery the real runway is visible.

## D-029 · Per-type aircraft models (generated) + a drop-in path for licensed photoreal ones
- **Every common ICAO type gets its own model** (53 models covering 218 designators, `shared/aircraftModels.json`):
  A319/A320/A321 ceo + neo, A220-100/300, 737-700/800/900, 737 MAX 7/8/9, 757, 767, 777-200/200LR/300ER/9,
  787-8/9/10, 747-400/8, A330-200/300/900, A340-300/600, A350-900/1000, A380, E175/E190/E195, CRJ200/700/900,
  ERJ-145, MD-80, 717, ATR 42/72, Dash 8-400, PC-12, King Air, three bizjet sizes, a helicopter and two light aircraft.
  Unknown types fall back to a representative model of their class (A320neo, 777-300ER, E190, ATR 72, …).
- **Why generated, not downloaded:** freely licensed photoreal airliner models with clear licences are rare, usually
  CC-BY-NC or editorial-only, often carry real airline liveries and trademarks, and weigh 5–50 MB each. Instead
  `scripts/build-models.ts` builds each type from public dimensions (length, span, fuselage width/height ratio, wing
  sweep/dihedral/kink, engine diameter and position, tail size, gear track and wheel count, door positions):
  nose profile and cockpit windscreen per manufacturer family (A350 "mask", 787 swept side windows, 747 upper deck),
  cabin windows and door outlines painted in a per-type UV texture, NACA-section wings with the right tip device
  (fences, sharklets, blended / split-scimitar / canted winglets, raked tips), turbofans with open inlets, fan face,
  spinner and exhaust cones, turboprops with 4/6-blade propellers, rear-mounted engines and T-tails where applicable,
  and multi-wheel bogies (4-wheel 787/A330, 6-wheel 777/A350-1000, A380/747 body gear). Original work → CC0.
- **Airline colours without trademarks:** tail and winglets carry a `_LIVERY` vertex attribute; a per-model
  `CustomShader` mixes in the operator's brand colour from `shared/airlines.ts` (IndiGo indigo, Air India red, …).
  No logos or names are painted, so nothing impersonates an airline.
- **Landing gear is a separate glTF node** hidden in flight: down on the ground, retracted ~120 m after takeoff,
  lowered again below ~600 m AGL on approach/landing (from the phase tracker).
- **Size:** quantized + `EXT_meshopt_compression` (decoded natively by Cesium): ~100 KB per model, ~40 KB gzipped;
  models are versioned by content hash and cached on first use by the service worker (not precached).
- **Photoreal upgrade path:** `npm run models:import` re-orients, scales to the real length, compresses and registers
  any licensed glTF (CC-BY, CC0 or purchased) for chosen ICAO types; imported models take precedence and the licence +
  author are written to `ASSETS_LICENSES.md`. Choosing and licensing such models is a human task (NEEDS_FROM_ME §16).
