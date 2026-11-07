/**
 * Fetches OpenStreetMap airport features for the curated airports and writes compact 3D scenery files:
 *   public/airports3d/<ICAO>.json   (terminals, hangars, control tower, jet bridges, aprons, taxiways)
 *
 *   npm run data:airport3d                 # all curated airports
 *   npm run data:airport3d -- VIDP VABB    # selected ones
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 (attribution shown in the app). Uses public Overpass API instances
 * sequentially with pauses; set OVERPASS_URL to use your own.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOsm, overpassQuery, type OsmElement } from '../shared/airport3d';
import { CURATED_PRESETS, presetFor } from '../shared/airportPresets';
import { airportIndex } from '../shared/airportData';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'airports3d');
const MIRRORS = (process.env.OVERPASS_URL ?? 'https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter').split(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOsm(icao: string): Promise<OsmElement[]> {
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

const wanted = process.argv.slice(2).filter((a) => /^[A-Z0-9]{4}$/i.test(a)).map((a) => a.toUpperCase());
const list = wanted.length ? wanted : Object.keys(CURATED_PRESETS);
mkdirSync(outDir, { recursive: true });
const airports = airportIndex();
for (const icao of list) {
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
