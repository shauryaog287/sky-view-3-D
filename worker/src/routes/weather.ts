import type { Router } from '../lib/http';
import { HttpError, json } from '../lib/http';
import type { Ctx } from '../context';
import { cached } from '../lib/cache';
import { USER_AGENT } from '../providers/types';
import { buildWeather, nearestMetar, type AwcMetar, type OpenMeteoCurrent } from '../weather';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const AWC = 'https://aviationweather.gov/api/data/metar';
const CURRENT = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,weather_code,wind_speed_10m,wind_direction_10m,temperature_2m,is_day';

/** Weather near a point: Open-Meteo current conditions (0.25° grid, 10 min) + nearest METAR (0.5° cell, 10 min). */
export function registerWeatherRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/weather', async (_req, ctx) => {
    const lat = Number(ctx.url.searchParams.get('lat'));
    const lon = Number(ctx.url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'bad_position');
    const gLat = Math.round(lat * 4) / 4;
    const gLon = Math.round(lon * 4) / 4;
    const cLat = Math.floor(lat * 2) / 2;
    const cLon = Math.floor(lon * 2) / 2;
    const [cur, metars] = await Promise.all([
      cached(`om:${gLat}:${gLon}`, 600, async () => {
        const res = await fetch(`${OPEN_METEO}?latitude=${gLat}&longitude=${gLon}&current=${CURRENT}&wind_speed_unit=kn`, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok) return null;
        return ((await res.json()) as { current?: OpenMeteoCurrent }).current ?? null;
      }).catch(() => null),
      cached(`metar:${cLat}:${cLon}`, 600, async () => {
        // A 1.5° box around the cell catches the nearest reporting airport in almost all populated areas.
        const bbox = [cLat - 0.75, cLon - 0.75, cLat + 1.25, cLon + 1.25].map((x) => x.toFixed(2)).join(',');
        const res = await fetch(`${AWC}?bbox=${bbox}&format=json`, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok || res.status === 204) return null;
        const text = await res.text();
        return text ? (JSON.parse(text) as AwcMetar[]) : null;
      }).catch(() => null),
    ]);
    const metar = metars ? nearestMetar(metars, lat, lon) : undefined;
    if (!cur && !metar) throw new HttpError(503, 'weather_unavailable', 'Weather services are not responding');
    return json(buildWeather(lat, lon, cur ?? undefined, metar), { cacheSeconds: 300 });
  });
}
