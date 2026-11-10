/**
 * Generates the per-type aircraft models in public/models/types/*.glb (original work, CC0) and the manifest
 * shared/aircraftModels.json that maps ICAO type designators to models.
 *
 *   npm run data:models               # everything
 *   npm run data:models -- a20n b77w  # just these (manifest entries for the rest are kept)
 *
 * Models are built from public dimensions of each type (see scripts/models/specs.ts): fuselage profile, nose and
 * cockpit windscreen, cabin windows and doors painted in a UV texture, wing planform with the right wingtip device,
 * engines (turbofan / turboprop / rear-mounted), tail, and landing gear in a separate "gear" node that the app hides in
 * flight. Tail and winglets carry a `_LIVERY` vertex attribute so the app can paint them in the operator's colour.
 *
 * Licensed third-party models (e.g. photoreal CC-BY or purchased models) are added with scripts/import-model.ts; their
 * manifest entries are preserved here.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { toGlb } from './models/core';
import { MATERIALS } from './models/airliner';
import { CLASS_DEFAULT, MODELS } from './models/specs';
import type { ModelManifest } from '../shared/aircraftModels';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models', 'types');
const manifestPath = join(root, 'shared', 'aircraftModels.json');
mkdirSync(outDir, { recursive: true });

const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith('-')));
const prev: ModelManifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as ModelManifest) : { v: 1, models: {}, types: {}, classes: {} as ModelManifest['classes'] };

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** Weld + quantize + EXT_meshopt_compression (Cesium decodes it natively): ~5× smaller downloads. */
async function compress(glb: Buffer): Promise<Uint8Array> {
  const doc = await io.readBinary(new Uint8Array(glb));
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizeTexcoord: 14, quantizeGeneric: 8 }));
  return io.writeBinary(doc);
}

const manifest: ModelManifest = { v: 1, models: {}, types: {}, classes: { ...CLASS_DEFAULT } };
let total = 0;
for (const def of MODELS) {
  const file = `types/${def.id}.glb`;
  if (only.size && !only.has(def.id) && prev.models[def.id]) {
    manifest.models[def.id] = prev.models[def.id];
  } else {
    const t0 = performance.now();
    const built = def.build();
    const textures = Object.fromEntries(Object.entries(built.textures).map(([k, t]) => [k, t.png()]));
    const glb = await compress(toGlb(built.b, MATERIALS, textures, { model: def.id, name: def.name, types: def.types }));
    writeFileSync(join(outDir, `${def.id}.glb`), glb);
    total += glb.length;
    manifest.models[def.id] = {
      file,
      rev: createHash('sha256').update(glb).digest('hex').slice(0, 10),
      name: def.name,
      cls: def.cls,
      length: round(built.length),
      span: round(built.span),
      height: round(built.height),
      livery: def.livery,
      gear: def.gear,
      ...(built.lights ? { lights: built.lights } : {}),
      source: 'generated',
    };
    console.log(`${def.id.padEnd(5)} ${(glb.length / 1024).toFixed(0).padStart(4)} KiB ${String(built.b.triangles()).padStart(6)} tris  ${((performance.now() - t0) / 1000).toFixed(1)} s  ${def.name}`);
  }
  for (const t of def.types) manifest.types[t] ??= def.id;
}
// Keep imported (licensed) models and their type mappings: they take precedence over generated ones.
for (const [id, m] of Object.entries(prev.models)) if (m.source !== 'generated') manifest.models[id] = m;
for (const [t, id] of Object.entries(prev.types)) if (prev.models[id] && prev.models[id].source !== 'generated') manifest.types[t] = id;
if (prev.liveries) manifest.liveries = prev.liveries;

writeFileSync(manifestPath, JSON.stringify(sortKeys(manifest), null, 1) + '\n');
console.log(`\n${Object.keys(manifest.models).length} models, ${Object.keys(manifest.types).length} type designators${total ? `, ${(total / 1024 / 1024).toFixed(2)} MiB written` : ''}`);

function round(n: number) {
  return Math.round(n * 100) / 100;
}
function sortKeys(m: ModelManifest): ModelManifest {
  const sort = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return { v: m.v, models: sort(m.models), types: sort(m.types), classes: m.classes, ...(m.liveries ? { liveries: m.liveries } : {}) };
}
