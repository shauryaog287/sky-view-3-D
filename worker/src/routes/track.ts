import type { Router } from '../lib/http';
import { HttpError } from '../lib/http';
import type { Ctx } from '../context';
import { hub } from '../context';
import { resolveUser } from '../auth';
import { requireFeature } from '../entitlements';

/** Track history for replay (last ≤ 120 min). Pro feature in freemium mode. */
export function registerTrackRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/track/:hex', async (_req, ctx, p) => {
    if (!/^~?[0-9a-f]{6}$/i.test(p.hex)) throw new HttpError(400, 'bad_hex');
    await requireFeature(ctx, await resolveUser(ctx), 'replay');
    const minutes = Math.min(120, Math.max(1, Number(ctx.url.searchParams.get('minutes')) || 60));
    return hub(ctx.env).fetch(`https://hub/track?hex=${encodeURIComponent(p.hex.toLowerCase())}&minutes=${minutes}`);
  });
}
