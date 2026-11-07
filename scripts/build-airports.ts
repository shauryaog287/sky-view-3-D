/**
 * Build-time import of the OurAirports dataset (public domain) into a compact JSON file.
 *
 *   npm run data:airports            # downloads CSVs into data/raw/ if missing, writes data/airports.json
 *   npm run data:airports -- --refresh   # force re-download
 *
 * Keeps large + medium airports, plus small airports with scheduled service and an IATA code.
 * Keeps open runways that have threshold coordinates (missing far ends are computed from heading + length).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './lib/csv';
import { encodeAirport, type Airport, type CompactAirportFile, type Runway, type RunwayEnd } from '../shared/airports';
import { bearingDeg, destinationPoint, FT_TO_M, haversineM, norm360 } from '../shared/geo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'data', 'raw');
const BASE = 'https://davidmegginson.github.io/ourairports-data';

async function ensure(file: string, refresh: boolean) {
  const path = join(rawDir, file);
  if (!refresh && existsSync(path)) return readFileSync(path, 'utf8');
  mkdirSync(rawDir, { recursive: true });
  console.log(`Downloading ${file}…`);
  const res = await fetch(`${BASE}/${file}`, { headers: { 'User-Agent': 'SkyView3D-build/0.1' } });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text);
  return text;
}

const num = (s: string | undefined) => (s === undefined || s === '' ? undefined : Number(s));

function main() {
  return (async () => {
    const refresh = process.argv.includes('--refresh');
    const airportsCsv = parseCsv(await ensure('airports.csv', refresh));
    const runwaysCsv = parseCsv(await ensure('runways.csv', refresh));

    const runwaysByAirport = new Map<string, Record<string, string>[]>();
    for (const r of runwaysCsv) {
      if (r.closed === '1') continue;
      const list = runwaysByAirport.get(r.airport_ref) ?? [];
      list.push(r);
      runwaysByAirport.set(r.airport_ref, list);
    }

    const out: Airport[] = [];
    let skippedNoRunway = 0;
    for (const a of airportsCsv) {
      const type = a.type;
      const keep =
        type === 'large_airport' ||
        type === 'medium_airport' ||
        (type === 'small_airport' && a.scheduled_service === 'yes' && a.iata_code !== '');
      if (!keep) continue;
      const lat = num(a.latitude_deg);
      const lon = num(a.longitude_deg);
      if (lat === undefined || lon === undefined) continue;
      const elevFt = num(a.elevation_ft) ?? 0;
      const ident = (a.icao_code || a.gps_code || a.ident).toUpperCase();

      const runways: Runway[] = [];
      for (const r of runwaysByAirport.get(a.id) ?? []) {
        const rw = buildRunway(r, elevFt);
        if (rw) runways.push(rw);
      }
      if (runways.length === 0 && type !== 'large_airport') {
        skippedNoRunway++;
        continue;
      }
      out.push({
        ident,
        iata: a.iata_code || undefined,
        name: a.name,
        city: a.municipality || undefined,
        country: a.iso_country,
        lat,
        lon,
        elevFt,
        kind: type === 'large_airport' ? 'L' : type === 'medium_airport' ? 'M' : 'S',
        runways,
      });
    }

    out.sort((x, y) => x.ident.localeCompare(y.ident));
    const file: CompactAirportFile = {
      v: 1,
      generated: new Date().toISOString().slice(0, 10),
      source: 'OurAirports (https://ourairports.com/data/)',
      licence: 'Public domain',
      airports: out.map(encodeAirport),
    };
    const json = JSON.stringify(file);
    writeFileSync(join(root, 'data', 'airports.json'), json);
    const rwCount = out.reduce((n, a) => n + a.runways.length, 0);
    console.log(
      `Wrote data/airports.json: ${out.length} airports, ${rwCount} runways, ${(json.length / 1024).toFixed(0)} KiB ` +
        `(skipped ${skippedNoRunway} without usable runways)`,
    );
  })();
}

function buildRunway(r: Record<string, string>, airportElevFt: number): Runway | undefined {
  const lengthFt = num(r.length_ft) ?? 0;
  const widthFt = num(r.width_ft) ?? 100;
  let le = end(r, 'le', airportElevFt);
  let he = end(r, 'he', airportElevFt);
  if (!le && !he) return undefined;
  // Compute a missing end from the other end's heading and the runway length.
  if (le && !he && lengthFt > 0 && le.hdg >= 0) he = projected(le, lengthFt, r.he_ident);
  if (he && !le && lengthFt > 0 && he.hdg >= 0) le = projected(he, lengthFt, r.le_ident);
  if (!le || !he) return undefined;
  const dist = haversineM(le.lat, le.lon, he.lat, he.lon);
  if (dist < 150) return undefined; // helipads / bad data
  // Fill missing headings from geometry.
  if (le.hdg < 0) le.hdg = bearingDeg(le.lat, le.lon, he.lat, he.lon);
  if (he.hdg < 0) he.hdg = bearingDeg(he.lat, he.lon, le.lat, le.lon);
  return { le, he, lengthFt: lengthFt || dist / FT_TO_M, widthFt, surface: (r.surface || '').slice(0, 6).toUpperCase() };
}

function end(r: Record<string, string>, p: 'le' | 'he', airportElevFt: number): RunwayEnd | undefined {
  const lat = num(r[`${p}_latitude_deg`]);
  const lon = num(r[`${p}_longitude_deg`]);
  if (lat === undefined || lon === undefined) return undefined;
  return {
    ident: r[`${p}_ident`] || '',
    lat,
    lon,
    elevFt: num(r[`${p}_elevation_ft`]) ?? airportElevFt,
    hdg: num(r[`${p}_heading_degT`]) ?? -1,
    displacedFt: num(r[`${p}_displaced_threshold_ft`]) ?? 0,
  };
}

function projected(from: RunwayEnd, lengthFt: number, ident: string): RunwayEnd {
  const p = destinationPoint(from.lat, from.lon, from.hdg, lengthFt * FT_TO_M);
  return { ident: ident || '', lat: p.lat, lon: p.lon, elevFt: from.elevFt, hdg: norm360(from.hdg + 180), displacedFt: 0 };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
