import type { Router } from '../lib/http';
import { HttpError, json, readJson } from '../lib/http';
import type { Ctx } from '../context';
import type { CreateAlertInput } from '../../../shared/apiTypes';
import { D1AlertStore, MemoryAlertStore, toRecord, type AlertStore } from '../alerts/store';
import { resolveUser } from '../auth';
import { requireFeature } from '../entitlements';

const memory = new MemoryAlertStore();
export function alertStore(ctx: { env: { DB?: D1Database } }): AlertStore {
  return ctx.env.DB ? new D1AlertStore(ctx.env.DB) : memory;
}

const CONDITIONS = ['takeoff', 'descent', 'approach', 'landed'] as const;
const MAX_ACTIVE = 10;

export function registerAlertRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/alerts', async (_req, ctx) => {
    const user = await resolveUser(ctx);
    if (!user && !ctx.deviceId) throw new HttpError(400, 'no_identity', 'X-Device-Id header required');
    const rows = await alertStore(ctx).listFor({ deviceId: ctx.deviceId, userId: user?.id });
    return json({ alerts: rows.map(toRecord) });
  });

  r.on('POST', '/api/alerts', async (req, ctx) => {
    const user = await resolveUser(ctx);
    await requireFeature(ctx, user, 'alerts');
    if (!ctx.deviceId) throw new HttpError(400, 'no_identity', 'X-Device-Id header required');
    const body = await readJson<CreateAlertInput>(req);
    if (!CONDITIONS.includes(body.condition)) throw new HttpError(400, 'bad_condition');
    const hex = body.hex && /^~?[0-9a-f]{6}$/i.test(body.hex) ? body.hex.toLowerCase() : null;
    const callsign = body.callsign && /^[A-Z0-9]{2,8}$/i.test(body.callsign) ? body.callsign.toUpperCase() : null;
    if (!hex && !callsign) throw new HttpError(400, 'bad_target', 'hex or callsign required');
    const airport = body.airport && /^[A-Z0-9]{3,4}$/i.test(body.airport) ? body.airport.toUpperCase() : null;
    const push =
      body.push && typeof body.push.endpoint === 'string' && body.push.endpoint.startsWith('https://') && body.push.keys?.p256dh && body.push.keys?.auth
        ? JSON.stringify({ endpoint: body.push.endpoint, keys: { p256dh: body.push.keys.p256dh, auth: body.push.keys.auth } })
        : null;
    const store = alertStore(ctx);
    if ((await store.countActive({ deviceId: ctx.deviceId, userId: user?.id })) >= MAX_ACTIVE) {
      throw new HttpError(429, 'too_many_alerts', `You can have up to ${MAX_ACTIVE} active alerts`);
    }
    const now = Date.now();
    const row = {
      id: crypto.randomUUID(),
      device_id: ctx.deviceId,
      user_id: user?.id ?? null,
      hex,
      callsign,
      label: String(body.label ?? callsign ?? hex).slice(0, 40),
      condition: body.condition,
      airport,
      push_sub: push && ctx.env.VAPID_PUBLIC_KEY && ctx.env.VAPID_PRIVATE_KEY ? push : null,
      last_phase: null,
      last_alt: null,
      created_at: now,
      expires_at: now + 24 * 3600_000,
      fired_at: null,
      active: 1,
    };
    await store.insert(row);
    return json(toRecord(row), { status: 201 });
  });

  r.on('DELETE', '/api/alerts/:id', async (_req, ctx, p) => {
    const user = await resolveUser(ctx);
    const ok = await alertStore(ctx).remove(p.id, { deviceId: ctx.deviceId, userId: user?.id });
    if (!ok) throw new HttpError(404, 'not_found');
    return json({ ok: true });
  });
}
