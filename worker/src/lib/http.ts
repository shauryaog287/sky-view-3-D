/** Tiny HTTP helpers: JSON responses, errors, CORS, and a minimal router. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function json(data: unknown, init: ResponseInit & { cacheSeconds?: number } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (init.cacheSeconds !== undefined && !headers.has('Cache-Control')) {
    headers.set('Cache-Control', init.cacheSeconds > 0 ? `public, max-age=${init.cacheSeconds}` : 'no-store');
  }
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.code, message: err.message }, { status: err.status });
  console.error('[api] unhandled', err);
  return json({ error: 'internal', message: 'Something went wrong' }, { status: 500 });
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin) return {};
  const ok = allowed.includes('*') || allowed.includes(origin);
  if (!ok) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function withHeaders(res: Response, extra: Record<string, string>): Response {
  if (!Object.keys(extra).length) return res;
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

export type Handler<C> = (req: Request, ctx: C, params: Record<string, string>) => Promise<Response> | Response;

export class Router<C> {
  private readonly routes: { method: string; re: RegExp; keys: string[]; h: Handler<C> }[] = [];

  on(method: string, path: string, h: Handler<C>): this {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        path.replace(/\/:([a-zA-Z_]+)/g, (_m, k: string) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, re, keys, h });
    return this;
  }

  async handle(req: Request, ctx: C): Promise<Response | undefined> {
    const url = new URL(req.url);
    for (const r of this.routes) {
      if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return r.h(req, ctx, params);
    }
    return undefined;
  }
}

export function parseBBoxParam(v: string | null): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  if (!v) throw new HttpError(400, 'bad_bbox', 'bbox=minLon,minLat,maxLon,maxLat is required');
  const n = v.split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) throw new HttpError(400, 'bad_bbox', 'bbox must be 4 numbers');
  const [minLon, minLat, maxLon, maxLat] = n;
  if (minLat < -90 || maxLat > 90 || minLat > maxLat || Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) {
    throw new HttpError(400, 'bad_bbox', 'bbox out of range');
  }
  return { minLat, minLon, maxLat, maxLon };
}

export async function readJson<T>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}
