import type { Router } from '../lib/http';
import { HttpError, json } from '../lib/http';
import type { Ctx } from '../context';
import { cached } from '../lib/cache';
import { USER_AGENT } from '../providers/types';
import type { AirportRef, FlightInfo } from '../../../shared/types';
import { airlineFromCallsign } from '../../../shared/airlines';

/**
 * Route + airframe enrichment from adsbdb.com (free, no key). Cached for a long time: airframes 7 days,
 * routes 6 hours, unknowns 1 hour. Routes are callsign-based schedule data and can be wrong for ad-hoc flights.
 */
const ADSBDB = 'https://api.adsbdb.com/v0';

interface AdsbdbAircraft {
  type?: string;
  icao_type?: string;
  manufacturer?: string;
  registration?: string;
  registered_owner?: string;
}
interface AdsbdbAirport {
  icao_code?: string;
  iata_code?: string;
  name?: string;
  municipality?: string;
  country_iso_name?: string;
  latitude?: number;
  longitude?: number;
}
interface AdsbdbRoute {
  callsign?: string;
  airline?: { name?: string; icao?: string; iata?: string } | null;
  origin?: AdsbdbAirport;
  destination?: AdsbdbAirport;
}

async function adsbdb<T>(path: string): Promise<T | null> {
  const res = await fetch(`${ADSBDB}${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, 'enrichment_unavailable', `adsbdb HTTP ${res.status}`);
  const body = (await res.json()) as { response?: unknown };
  return typeof body.response === 'object' && body.response ? (body.response as T) : null;
}

function airport(a?: AdsbdbAirport): AirportRef | undefined {
  if (!a) return undefined;
  return { icao: a.icao_code, iata: a.iata_code, name: a.name, city: a.municipality, country: a.country_iso_name, lat: a.latitude, lon: a.longitude };
}

export async function lookupFlightInfo(hex: string, callsign: string | undefined): Promise<FlightInfo> {
  const cleanHex = hex.replace('~', '').toLowerCase();
  const [ac, route] = await Promise.all([
    /^[0-9a-f]{6}$/.test(cleanHex)
      ? cached(`adsbdb:ac:${cleanHex}`, 7 * 86_400, () => adsbdb<{ aircraft: AdsbdbAircraft }>(`/aircraft/${cleanHex}`), 3600).catch(() => null)
      : Promise.resolve(null),
    callsign && /^[A-Z0-9]{3,8}$/i.test(callsign)
      ? cached(`adsbdb:route:${callsign.toUpperCase()}`, 6 * 3600, () => adsbdb<{ flightroute: AdsbdbRoute }>(`/callsign/${callsign.toUpperCase()}`), 3600).catch(() => null)
      : Promise.resolve(null),
  ]);
  const info: FlightInfo = { hex: cleanHex, callsign, source: 'adsbdb.com' };
  const fr = route?.flightroute;
  if (fr) {
    info.origin = airport(fr.origin);
    info.destination = airport(fr.destination);
    if (fr.airline) info.airline = { name: fr.airline.name, icao: fr.airline.icao, iata: fr.airline.iata };
  }
  if (!info.airline) {
    const al = airlineFromCallsign(callsign);
    if (al) info.airline = { name: al.name, icao: al.icao, iata: al.iata };
  }
  const a = ac?.aircraft;
  if (a) {
    info.aircraft = { type: a.type, icaoType: a.icao_type, manufacturer: a.manufacturer, reg: a.registration, owner: a.registered_owner };
  }
  return info;
}

export function registerInfoRoutes(r: Router<Ctx>) {
  r.on('GET', '/api/info/:hex', async (_req, ctx, p) => {
    if (ctx.env.ENRICHMENT === 'off') return json({ hex: p.hex } satisfies FlightInfo);
    const callsign = ctx.url.searchParams.get('callsign')?.trim() || undefined;
    if (!/^~?[0-9a-f]{6}$/i.test(p.hex)) throw new HttpError(400, 'bad_hex');
    return json(await lookupFlightInfo(p.hex, callsign), { cacheSeconds: 300 });
  });
}
