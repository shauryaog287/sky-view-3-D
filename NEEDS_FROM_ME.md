# Needs from you

Everything here needs a human (accounts, keys, payments, legal). **The app already runs without any of it**: missing
items fall back to mocks, recorded fixtures or cheaper layers. Work top to bottom; each item says exactly where to click
and which variable to fill. Secrets go in `worker/.dev.vars` locally and `wrangler secret put NAME` in production;
public values go in `.env.local` (frontend) or `worker/wrangler.toml` `[vars]`.

## 1. Cloudflare account (required to deploy)
1. Sign up at https://dash.cloudflare.com/sign-up (free plan is enough to start; Durable Objects with SQLite storage
   are available on the free plan).
2. On your machine: `npx wrangler login`.
3. Create the database and KV namespace, then paste the printed ids into `worker/wrangler.toml`:
   ```bash
   npx wrangler d1 create skyview           # → [[d1_databases]] database_id
   npx wrangler kv namespace create CACHE   # → [[kv_namespaces]] id
   npm run db:migrate:remote
   ```
4. Create the Pages project once: `npx wrangler pages project create skyview-3d --production-branch main`.

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

_(More items are added as milestones land.)_
