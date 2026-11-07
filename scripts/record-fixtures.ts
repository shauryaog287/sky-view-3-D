/**
 * Records real ADS-B snapshots (readsb "v2" JSON) around the preset airports into fixtures/adsb-v2/.
 * These power mock mode, the FixtureProvider and parser tests, so every screen works without keys.
 *
 *   npm run data:fixtures
 *
 * Source: adsb.lol (data licensed ODbL 1.0 — attribution kept in fixtures/README.md and the Data Sources page).
 * Requests are spaced 3 s apart to respect the community rate limit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'fixtures', 'adsb-v2');

const SPOTS: [string, number, number][] = [
  ['DEL', 28.5665, 77.1031],
  ['BOM', 19.0887, 72.8679],
  ['BLR', 13.1979, 77.7063],
  ['MAA', 12.99, 80.1693],
  ['CCU', 22.6547, 88.4467],
  ['HYD', 17.2313, 78.4298],
  ['RPR', 21.1804, 81.7388],
  ['DXB', 25.2528, 55.3644],
  ['LHR', 51.4706, -0.4619],
  ['SIN', 1.3502, 103.994],
  ['JFK', 40.6398, -73.7789],
  ['FRA', 50.0333, 8.5706],
];

// Fields we actually consume; everything else is dropped to keep fixtures small.
const KEEP = [
  'hex', 'type', 'flight', 'r', 't', 'category', 'alt_baro', 'alt_geom', 'gs', 'track', 'track_rate', 'roll',
  'true_heading', 'baro_rate', 'geom_rate', 'squawk', 'emergency', 'lat', 'lon', 'seen_pos', 'seen', 'mlat',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',') : undefined;
  for (const [code, lat, lon] of SPOTS) {
    if (only && !only.includes(code)) continue;
    const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/60`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SkyView3D-fixtures/0.1', Accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`${code}: HTTP ${res.status}`);
      await sleep(3000);
      continue;
    }
    const body = (await res.json()) as { now: number; ac?: Record<string, unknown>[] };
    const ac = (body.ac ?? [])
      .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number')
      .map((a) => {
        const o: Record<string, unknown> = {};
        for (const k of KEEP) if (a[k] !== undefined) o[k] = k === 'mlat' ? ((a[k] as unknown[]).length ? ['lat'] : []) : a[k];
        return o;
      });
    const file = { source: 'adsb.lol', licence: 'ODbL-1.0', recordedAt: new Date(body.now).toISOString(), now: body.now, center: [lat, lon], ac };
    writeFileSync(join(outDir, `${code}.json`), JSON.stringify(file));
    console.log(`${code}: ${ac.length} aircraft`);
    await sleep(3000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
