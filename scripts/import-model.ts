/**
 * Adds a third-party aircraft model (e.g. a photoreal CC-BY model from Sketchfab, or one you bought) for one or more
 * ICAO types. The model is re-oriented and scaled to the app's convention, compressed, copied to
 * public/models/licensed/<id>.glb and registered in shared/aircraftModels.json (imported models take precedence over
 * the generated ones for the listed types). A row is appended to ASSETS_LICENSES.md — licence and author are required.
 *
 *   npm run models:import -- --file ~/Downloads/a320.glb --id a320-photo --types A320,A20N \
 *     --name "Airbus A320" --licence CC-BY-4.0 --author "Jane Doe" --url https://sketchfab.com/3d-models/... \
 *     [--forward +z] [--up +y] [--length 37.57] [--gear-node Gear]
 *
 * --forward / --up: the model's nose and top directions in its own axes (look at it in any glTF viewer). Default
 * +z forward, +y up (the glTF convention); many exports use -z or +x forward.
 * --length: real overall length in metres; the model is scaled to it (default: the type's generated model length).
 * --gear-node: name of the node holding the landing gear, so the app can retract it in flight (optional).
 *
 * Only .glb / .gltf without Draco compression are supported (re-export with Draco off, or run
 * `npx @gltf-transform/cli draco-decode` first). Remember to also credit the author on public/legal/sources.html.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getBounds, Logger, NodeIO, type mat4 } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { modelClassFor } from '../shared/aircraftTypes';
import type { ModelManifest } from '../shared/aircraftModels';

const { values: a } = parseArgs({
  options: {
    file: { type: 'string' },
    id: { type: 'string' },
    types: { type: 'string' },
    name: { type: 'string' },
    licence: { type: 'string' },
    author: { type: 'string' },
    url: { type: 'string' },
    forward: { type: 'string', default: '+z' },
    up: { type: 'string', default: '+y' },
    length: { type: 'string' },
    'gear-node': { type: 'string' },
  },
});
const need = ['file', 'id', 'types', 'name', 'licence', 'author', 'url'] as const;
for (const k of need) if (!a[k]) fail(`--${k} is required`);
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(a.id!)) fail('--id must be lowercase letters, digits and dashes');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'shared', 'aircraftModels.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ModelManifest;
const types = a.types!.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);

type V = [number, number, number];
const axis = (s: string): V => {
  const m = /^([+-])([xyz])$/.exec(s.trim().toLowerCase());
  if (!m) fail(`bad axis "${s}" (use +x, -z, …)`);
  const v: V = [0, 0, 0];
  v['xyz'.indexOf(m![2])] = m![1] === '-' ? -1 : 1;
  return v;
};
const fwd = axis(a.forward!);
const up = axis(a.up!);
if (fwd.some((v, i) => v !== 0 && up[i] !== 0)) fail('--forward and --up must be different axes');
// Rotation taking the model's (right, up, forward) onto glTF (+X left wing … see below), i.e. forward → +Z, up → +Y.
const left: V = [up[1] * fwd[2] - up[2] * fwd[1], up[2] * fwd[0] - up[0] * fwd[2], up[0] * fwd[1] - up[1] * fwd[0]];
// Rows of R are the source axes expressed as target axes: target = R · source, with X = left, Y = up, Z = forward.
const R = [left, up, fwd];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(a.file!);
doc.setLogger(new Logger(Logger.Verbosity.WARN));
if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_draco_mesh_compression')) fail('Draco-compressed models are not supported; decode them first.');
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
if (!scene) fail('no scene in the file');

// Wrap everything in one root node, rotate, then measure, scale and centre.
const wrapper = doc.createNode('aircraft');
for (const child of scene.listChildren()) {
  scene.removeChild(child);
  wrapper.addChild(child);
}
scene.addChild(wrapper);
const rot: mat4 = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, 0, 0, 0, 1];
wrapper.setMatrix(rot);
let b = getBounds(scene);
const lengthNow = b.max[2] - b.min[2];
const generated = manifest.models[manifest.types[types[0]] ?? ''];
const targetLength = a.length ? Number(a.length) : generated?.length;
if (!targetLength || !(lengthNow > 0)) fail('cannot determine the length; pass --length <metres>');
const k = targetLength! / lengthNow;
const outer = doc.createNode('import');
scene.removeChild(wrapper);
outer.addChild(wrapper);
scene.addChild(outer);
outer.setScale([k, k, k]);
b = getBounds(scene);
outer.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
b = getBounds(scene);
if (a['gear-node']) {
  const g = doc.getRoot().listNodes().find((n) => n.getName() === a['gear-node']);
  if (!g) fail(`no node named "${a['gear-node']}"`);
  g!.setName('gear');
}

await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
doc.createExtension(EXTMeshoptCompression).setRequired(true);
const glb = await io.writeBinary(doc);
const outDir = join(root, 'public', 'models', 'licensed');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${a.id}.glb`), glb);

manifest.models[a.id!] = {
  file: `licensed/${a.id}.glb`,
  rev: createHash('sha256').update(glb).digest('hex').slice(0, 10),
  name: a.name!,
  cls: generated?.cls ?? modelClassFor(types[0]),
  length: round(b.max[2] - b.min[2]),
  span: round(b.max[0] - b.min[0]),
  height: round(b.max[1] - b.min[1]),
  livery: false,
  gear: !!a['gear-node'],
  source: 'licensed',
  licence: a.licence,
  author: a.author,
  url: a.url,
};
for (const t of types) manifest.types[t] = a.id!;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
appendFileSync(
  join(root, 'ASSETS_LICENSES.md'),
  `| \`public/models/licensed/${a.id}.glb\` (${a.name}; used for ${types.join(', ')}) | ${a.author}, ${a.url} | ${a.licence} | ${/^CC0/i.test(a.licence!) ? 'No' : `Yes: "${a.name}" by ${a.author} (${a.licence}) — listed on the Data sources page`} |\n`,
);
console.log(`Imported ${a.id}: ${(glb.length / 1024).toFixed(0)} KiB, ${round(b.max[2] - b.min[2])} m long, ${round(b.max[0] - b.min[0])} m span → ${types.join(', ')}`);
console.log('Now add the author credit to public/legal/sources.html (CC-BY requires it) and check the model with `npm run dev`.');

function round(n: number) {
  return Math.round(n * 100) / 100;
}
function fail(msg: string): never {
  console.error(`import-model: ${msg}`);
  process.exit(1);
}
