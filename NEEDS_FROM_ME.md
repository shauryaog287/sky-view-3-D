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

_(More items are added as milestones land.)_
