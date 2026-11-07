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
