import type { Router } from '../lib/http';
import { HttpError, json } from '../lib/http';
import type { Ctx } from '../context';
import { cached } from '../lib/cache';
import { USER_AGENT } from '../providers/types';
import { listVar } from '../env';
import { airportIndex } from '../../../shared/airportData';
import { convertOsm, overpassQuery, type Airport3D, type OsmElement } from '../../../shared/airport3d';
import { CURATED_PRESETS, presetFor } from '../../../shared/airportPresets';

const DEFAULT_OVERPASS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter'];

/**
 * 3D airport scenery for any airport, built from OpenStreetMap via Overpass and cached for 7 days (Cache API), so
 * Overpass sees at most one request per airport per week per data centre. Curated airports also ship as static files.
 */
export function registerAirport3dRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/airport3d/:icao', async (_req, ctx, p) => {
    const icao = p.icao.toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) throw new HttpError(400, 'bad_icao');
    const ap = airportIndex().get(icao);
    if (!ap) throw new HttpError(404, 'unknown_airport');
    const urls = listVar(ctx.env.OVERPASS_URLS, DEFAULT_OVERPASS);
    const data = await cached<Airport3D>(
      `a3d:v1:${ap.ident}`,
      7 * 86_400,
      async () => {
        for (const url of urls) {
          try {
            const res = await fetch(url, {
              method: 'POST',
              body: new URLSearchParams({ data: overpassQuery(ap.ident) }),
              headers: { 'User-Agent': USER_AGENT },
            });
            if (!res.ok) continue;
            const j = (await res.json()) as { elements: OsmElement[] };
            const towerHeightM = CURATED_PRESETS[ap.ident] ? presetFor(ap.ident).towerHeightM : undefined;
            return convertOsm(ap.ident, [ap.lat, ap.lon], j.elements, undefined, { towerHeightM });
          } catch {
            /* try the next mirror */
          }
        }
        return null;
      },
      1800,
    );
    if (!data) throw new HttpError(503, 'scenery_unavailable', 'OpenStreetMap data is temporarily unavailable');
    return json(data, { cacheSeconds: 86_400 });
  });
}
