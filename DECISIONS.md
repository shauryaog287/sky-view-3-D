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
