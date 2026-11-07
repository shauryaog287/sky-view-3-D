import type { WeatherInfo, WeatherCloudLayer } from '../../shared/types';
import { haversineM } from '../../shared/geo';

/** aviationweather.gov METAR JSON (subset). */
export interface AwcMetar {
  icaoId: string;
  obsTime: number;
  rawOb: string;
  visib?: number | string;
  altim?: number;
  wxString?: string;
  fltCat?: string;
  lat: number;
  lon: number;
  clouds?: { cover: string; base: number | null }[];
}

export interface OpenMeteoCurrent {
  cloud_cover?: number;
  cloud_cover_low?: number;
  cloud_cover_mid?: number;
  cloud_cover_high?: number;
  visibility?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  temperature_2m?: number;
  is_day?: number;
}

const SM_TO_M = 1609.344;

/** METAR visibility comes in statute miles, sometimes as "10+" or "1/2". */
export function metarVisibilityM(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return Math.round(v * SM_TO_M);
  const s = v.trim().replace('+', '');
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * SM_TO_M);
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * SM_TO_M) : undefined;
}

export function parseMetar(m: AwcMetar): NonNullable<WeatherInfo['metar']> {
  const clouds: WeatherCloudLayer[] = (m.clouds ?? [])
    .filter((c) => c.base !== null && c.base !== undefined && ['FEW', 'SCT', 'BKN', 'OVC', 'VV'].includes(c.cover))
    .map((c) => ({ cover: c.cover === 'VV' ? 'OVC' : c.cover, baseFt: c.base as number }));
  return {
    station: m.icaoId,
    raw: m.rawOb,
    obsTime: m.obsTime * 1000,
    visibilityM: metarVisibilityM(m.visib),
    clouds,
    flightCategory: m.fltCat,
    altimeterHpa: typeof m.altim === 'number' ? m.altim : undefined,
    wx: m.wxString,
  };
}

/** Nearest METAR to a point, ignoring observations older than 3 h. */
export function nearestMetar(list: AwcMetar[], lat: number, lon: number, now = Date.now()): AwcMetar | undefined {
  return list
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon) && now - m.obsTime * 1000 < 3 * 3600_000)
    .sort((a, b) => haversineM(lat, lon, a.lat, a.lon) - haversineM(lat, lon, b.lat, b.lon))[0];
}

export function buildWeather(lat: number, lon: number, cur: OpenMeteoCurrent | undefined, metar: AwcMetar | undefined, now = Date.now()): WeatherInfo {
  const w: WeatherInfo = { lat, lon, fetchedAt: now, sources: [] };
  if (cur) {
    w.cloudCover = cur.cloud_cover;
    w.cloudLow = cur.cloud_cover_low;
    w.cloudMid = cur.cloud_cover_mid;
    w.cloudHigh = cur.cloud_cover_high;
    w.visibilityM = cur.visibility;
    w.weatherCode = cur.weather_code;
    w.windKt = cur.wind_speed_10m;
    w.windDir = cur.wind_direction_10m;
    w.tempC = cur.temperature_2m;
    w.isDay = cur.is_day === undefined ? undefined : cur.is_day === 1;
    w.sources.push('Open-Meteo.com (CC BY 4.0)');
  }
  if (metar) {
    w.metar = parseMetar(metar);
    w.sources.push('NOAA Aviation Weather Center');
    // A nearby METAR is the better visibility source near airports.
    if (w.metar.visibilityM !== undefined && haversineM(lat, lon, metar.lat, metar.lon) < 40_000) w.visibilityM = w.metar.visibilityM;
  }
  return w;
}
