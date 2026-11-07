import type { Router } from '../lib/http';
import { HttpError } from '../lib/http';
import type { Ctx } from '../context';
import { hub } from '../context';

/** Live aircraft, search and provider status: all proxied to the FlightHub Durable Object. */
export function registerFlightRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/aircraft', (req, ctx) => {
    const bbox = ctx.url.searchParams.get('bbox');
    if (!bbox) throw new HttpError(400, 'bad_bbox', 'bbox is required');
    return hub(ctx.env).fetch(`https://hub/aircraft?bbox=${encodeURIComponent(bbox)}`);
  });
  r.on('GET', '/api/search', (req, ctx) =>
    hub(ctx.env).fetch(`https://hub/search?q=${encodeURIComponent(ctx.url.searchParams.get('q') ?? '')}`),
  );
  r.on('GET', '/api/status', (req, ctx) => hub(ctx.env).fetch('https://hub/status'));
}
