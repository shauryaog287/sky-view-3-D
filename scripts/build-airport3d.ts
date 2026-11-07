/**
 * Fetches OpenStreetMap airport features for the curated airports and writes compact 3D scenery files:
 *   public/airports3d/<ICAO>.json   (terminals, hangars, control tower, jet bridges, aprons, taxiways)
 *
 *   npm run data:airport3d                 # all curated airports
 *   npm run data:airport3d -- VIDP VABB    # selected ones
 *   npm run data:airport3d -- --india-intl      # every Indian international airport
 *   npm run data:airport3d -- --india-domestic  # every other Indian airport with airline service
 *   (airports that already have a file are skipped unless --force)
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 (attribution shown in the app). Uses public Overpass API instances
 * sequentially with pauses; set OVERPASS_URL to use your own.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOsm, overpassQuery, type OsmElement } from '../shared/airport3d';
import { CURATED_PRESETS, presetFor } from '../shared/airportPresets';
import { airportIndex } from '../shared/airportData';
import { INDIA_INTERNATIONAL, indiaDomestic } from '../shared/indiaAirports';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'airports3d');
const MIRRORS = (process.env.OVERPASS_URL ?? 'https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter').split(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Public Overpass servers are often overloaded (502/503/504): try every mirror, three rounds with growing pauses. */
async function fetchOsm(icao: string): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (let round = 0; round < 3; round++) {
    if (round) await sleep(20_000 * round);
    try {
      return await fetchOnce(icao);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function fetchOnce(icao: string): Promise<OsmElement[]> {
  const body = new URLSearchParams({ data: overpassQuery(icao) });
  let lastErr: unknown;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { method: 'POST', body, headers: { 'User-Agent': 'SkyView3D-build/0.1' }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { elements: OsmElement[] };
      return j.elements;
    } catch (e) {
      lastErr = e;
      console.warn(`  ${url}: ${(e as Error).message}`);
    }
  }
  throw lastErr;
}

const args = process.argv.slice(2);
const wanted = args.filter((a) => /^[A-Z0-9]{4}$/i.test(a)).map((a) => a.toUpperCase());
const airports = airportIndex();
if (args.includes('--india-intl')) wanted.push(...INDIA_INTERNATIONAL);
if (args.includes('--india-domestic')) wanted.push(...indiaDomestic(airports).map((a) => a.ident));
const list = wanted.length ? [...new Set(wanted)] : Object.keys(CURATED_PRESETS);
mkdirSync(outDir, { recursive: true });
const force = args.includes('--force');
for (const icao of list) {
  if (!force && !wanted.length) {
    /* curated default run: always refresh */
  } else if (!force && existsSync(join(outDir, `${icao}.json`))) {
    console.log(`${icao}: already built (use --force to refresh)`);
    continue;
  }
  const ap = airports.get(icao);
  if (!ap) {
    console.warn(`${icao}: not in airports dataset`);
    continue;
  }
  try {
    const elements = await fetchOsm(icao);
    const curated = CURATED_PRESETS[icao] ? presetFor(icao).towerHeightM : undefined;
    const a = convertOsm(icao, [ap.lat, ap.lon], elements, undefined, { towerHeightM: curated });
    const json = JSON.stringify(a);
    writeFileSync(join(outDir, `${icao}.json`), json);
    console.log(`${icao}: ${a.buildings.length} buildings, ${a.bridges.length} jet bridges, ${a.towers.length} towers, ${a.taxiways.length} taxiways — ${(json.length / 1024).toFixed(0)} KiB`);
  } catch (e) {
    console.error(`${icao}: failed (${(e as Error).message})`);
  }
  await sleep(4000);
}
