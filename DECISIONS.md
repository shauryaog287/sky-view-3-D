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
