import type { Router } from '../lib/http';
import { HttpError, json, readJson } from '../lib/http';
import type { Ctx } from '../context';
import type { UsageEvent } from '../../../shared/apiTypes';
import { FEATURE_IDS } from '../../../src/config/features';
import { utcDay } from '../lib/counters';
import { timingSafeEqual } from '../billing/hmac';

const EVENTS = new Set(['view', 'use', 'locked', 'upsell_click']);

/**
 * First-party, privacy-friendly feature analytics: the client sends aggregated counts (feature × event), we add them to
 * daily totals. No user id, no device id, no IP is stored.
 */
export function registerEventRoutes(r: Router<Ctx>) {
  r.on('POST', '/api/events', async (req, ctx) => {
    const { events } = await readJson<{ events: UsageEvent[] }>(req, 16 * 1024);
    if (!Array.isArray(events)) throw new HttpError(400, 'bad_events');
    const valid = events
      .filter((e) => (FEATURE_IDS as string[]).includes(e.feature) && EVENTS.has(e.event) && Number.isInteger(e.count) && e.count > 0 && e.count <= 500)
      .slice(0, 50);
    if (ctx.env.DB && valid.length) {
      const day = utcDay();
      const stmt = ctx.env.DB.prepare(
        'INSERT INTO feature_usage (day, feature, event, count) VALUES (?, ?, ?, ?) ON CONFLICT(day, feature, event) DO UPDATE SET count = count + excluded.count',
      );
      await ctx.env.DB.batch(valid.map((e) => stmt.bind(day, e.feature, e.event, e.count)));
    }
    return json({ ok: true, accepted: valid.length });
  });

  // Aggregated usage for deciding what to put behind the paywall. Protected by the ADMIN_TOKEN secret.
  r.on('GET', '/api/admin/usage', async (req, ctx) => {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (!ctx.env.ADMIN_TOKEN || !timingSafeEqual(token, ctx.env.ADMIN_TOKEN)) throw new HttpError(401, 'unauthorized');
    if (!ctx.env.DB) return json({ days: [] });
    const days = Math.min(90, Number(ctx.url.searchParams.get('days')) || 30);
    const since = utcDay(Date.now() - days * 86_400_000);
    const rows = await ctx.env.DB.prepare('SELECT feature, event, SUM(count) AS count FROM feature_usage WHERE day >= ? GROUP BY feature, event ORDER BY count DESC')
      .bind(since)
      .all();
    return json({ since, rows: rows.results });
  });
}
