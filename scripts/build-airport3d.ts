/**
 * Builds the compact 3D scenery files public/airports3d/<ICAO>.json from OpenStreetMap (terminals, hangars, towers,
 * jet bridges, tanks, masts, stands, runway centrelines, aprons, taxiways, boundary).
 *
 *   npm run data:airport3d                      # the curated airports
 *   npm run data:airport3d -- VIDP VABB         # selected ones
 *   npm run data:airport3d -- --india-intl      # every Indian international airport
 *   npm run data:airport3d -- --india-domestic  # every other Indian airport with airline service
 *   npm run data:airport3d -- --world-hubs      # major international hubs (shared/worldHubs.ts)
 *   npm run data:airport3d -- --all             # all of the above
 *   npm run data:airport3d -- --rebuild         # re-convert everything already downloaded (no network)
 *
 * Raw OSM data is cached under .cache/osm/ (not committed): an airport is downloaded once and never again unless
 * --force is given. Sources: Overpass (OVERPASS_URL, comma-separated mirrors) with the main OSM API as fallback for
 * small bounding-box extracts; `--source api|overpass` forces one. Requests are sequential and rate-limited.
 * Data © OpenStreetMap contributors, ODbL 1.0 (attribution shown in the app).
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOsm } from '../shared/airport3d';
import { CURATED_PRESETS, presetFor } from '../shared/airportPresets';
import { airportIndex } from '../shared/airportData';
import { INDIA_INTERNATIONAL, indiaDomestic } from '../shared/indiaAirports';
import { WORLD_HUBS } from '../shared/worldHubs';
import { OsmSource } from './lib/osmSource';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'airports3d');
const cacheDir = join(root, '.cache', 'osm');
const MIRRORS = (process.env.OVERPASS_URL ?? 'https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter').split(',');

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const sourceArg = args[args.indexOf('--source') + 1];
const source = new OsmSource(cacheDir, MIRRORS, flag('--source') && (sourceArg === 'api' || sourceArg === 'overpass') ? sourceArg : 'auto');
const airports = airportIndex();
const wanted = args.filter((a) => /^[A-Z0-9]{4}$/i.test(a)).map((a) => a.toUpperCase());
if (flag('--india-intl') || flag('--all')) wanted.push(...INDIA_INTERNATIONAL);
if (flag('--india-domestic') || flag('--all')) wanted.push(...indiaDomestic(airports).map((a) => a.ident));
if (flag('--world-hubs') || flag('--all')) wanted.push(...WORLD_HUBS);
if (flag('--rebuild')) {
  mkdirSync(cacheDir, { recursive: true });
  wanted.push(...readdirSync(cacheDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
}
const list = wanted.length ? [...new Set(wanted)] : Object.keys(CURATED_PRESETS);
mkdirSync(outDir, { recursive: true });

let ok = 0;
let failed = 0;
let bytes = 0;
for (const icao of list) {
  const ap = airports.get(icao);
  if (!ap) {
    console.warn(`${icao}: not in airports dataset`);
    continue;
  }
  if (flag('--rebuild') && !source.cached(icao)) continue;
  try {
    const { elements, source: from } = await source.get(ap, flag('--force'));
    const curated = CURATED_PRESETS[icao] ? presetFor(icao).towerHeightM : undefined;
    const a = convertOsm(icao, [ap.lat, ap.lon], elements, undefined, { towerHeightM: curated });
    const json = JSON.stringify(a);
    writeFileSync(join(outDir, `${icao}.json`), json);
    bytes += json.length;
    ok++;
    console.log(
      `${icao} ${(ap.iata ?? '').padEnd(3)} [${from}] ${a.buildings.length} bld, ${a.bridges.length} bridges, ${a.towers.length} twr, ${a.taxiways.length} twy, ${a.runways?.length ?? 0} rwy, ${(a.stands?.length ?? 0) / 2} stands, ${a.tanks?.length ?? 0} tanks, ${a.masts?.length ?? 0} masts${a.boundary ? '' : ', no boundary'} — ${(json.length / 1024).toFixed(0)} KiB`,
    );
  } catch (e) {
    failed++;
    console.error(`${icao}: failed (${(e as Error).message})`);
  }
}
console.log(`\n${ok} airports written (${(bytes / 1024 / 1024).toFixed(1)} MiB)${failed ? `, ${failed} failed` : ''}`);
