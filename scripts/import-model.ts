/**
 * Adds a third-party aircraft model (e.g. a photoreal CC-BY model from Sketchfab, or one you bought) for one or more
 * ICAO types. The model is re-oriented and scaled to the app's convention, compressed, copied to
 * public/models/licensed/<id>.glb and registered in shared/aircraftModels.json (imported models take precedence over
 * the generated ones for the listed types). A row is appended to ASSETS_LICENSES.md — licence and author are required.
 *
 *   npm run models:import -- --file ~/Downloads/a320.glb --id a320-photo --types A320,A20N \
 *     --name "Airbus A320" --licence CC-BY-4.0 --author "Jane Doe" --url https://sketchfab.com/3d-models/... \
 *     [--airlines IGO] [--forward +z] [--up +y] [--length 37.57] [--gear-node Gear]
 *
 * --airlines: make it an airline-specific replica (that operator's livery): used only for flights whose callsign
 * belongs to one of these ICAO airline codes (IGO = IndiGo, AIC = Air India, …); others keep the generic model.
 * Without it, the model replaces the generic one for every operator of these types.
 * --forward / --up: the model's nose and top directions in its own axes. Default: detected from the shape (the tall
 * fin marks the tail and the top). Pass them (e.g. --forward -z --up +y) only if the detection gets it wrong.
 * --paint: `auto` (default) finds fuselage, fin, winglets and engine cowls from the shape and marks them so airline
 * paint schemes apply (best on plain white models); `none` keeps the model's own colours for every operator.
 * Airline-specific replicas (--airlines) are never repainted.
 * --gear: `auto` (default) finds the landing gear (separate parts under the belly that reach the ground) so it
 * retracts in flight; `none` leaves it fixed.
 * --length: real overall length in metres; the model is scaled to it (default: the type's generated model length).
 * --preview <file.glb>: trial run. Writes the converted model to that file and changes nothing in the app.
 * --gear-node: name of the node holding the landing gear, when the automatic detection misses it (optional).
 *
 * Only .glb / .gltf without Draco compression are supported (re-export with Draco off, or run
 * `npx @gltf-transform/cli draco-decode` first). Remember to also credit the author on public/legal/sources.html.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Logger, NodeIO, type Document, type Accessor, type Material, type Node, type Primitive, type Scene } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { compactPrimitive, copyToDocument, dedup, dequantize, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { modelClassFor } from '../shared/aircraftTypes';
import type { ModelManifest } from '../shared/aircraftModels';
import { analyse, detectAxes, type MeshIn, type V3 } from './models/analyse';

const { values: a } = parseArgs({
  options: {
    file: { type: 'string' },
    id: { type: 'string' },
    types: { type: 'string' },
    name: { type: 'string' },
    licence: { type: 'string' },
    author: { type: 'string' },
    url: { type: 'string' },
    forward: { type: 'string' },
    up: { type: 'string' },
    paint: { type: 'string', default: 'auto' },
    gear: { type: 'string', default: 'auto' },
    length: { type: 'string' },
    'gear-node': { type: 'string' },
    airlines: { type: 'string' },
    preview: { type: 'string' },
  },
});
const need = ['file', 'id', 'types', 'name', 'licence', 'author', 'url'] as const;
for (const k of need) if (!a[k]) fail(`--${k} is required`);
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(a.id!)) fail('--id must be lowercase letters, digits and dashes');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'shared', 'aircraftModels.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ModelManifest;
const types = a.types!.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
const airlines = (a.airlines ?? '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
for (const al of airlines) if (!/^[A-Z]{3}$/.test(al)) fail(`--airlines takes 3-letter ICAO airline codes (got "${al}")`);

type V = V3;
const axis = (s: string): V => {
  const m = /^([+-])([xyz])$/.exec(s.trim().toLowerCase());
  if (!m) fail(`bad axis "${s}" (use +x, -z, …)`);
  const v: V = [0, 0, 0];
  v['xyz'.indexOf(m![2])] = m![1] === '-' ? -1 : 1;
  return v;
};
if (!!a.forward !== !!a.up) fail('pass both --forward and --up, or neither (automatic)');
if (!['auto', 'none'].includes(a.paint!)) fail('--paint is auto or none');
if (!['auto', 'none'].includes(a.gear!)) fail('--gear is auto or none');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(a.file!);
doc.setLogger(new Logger(Logger.Verbosity.WARN));
const gltf = doc.getRoot();
if (gltf.listExtensionsUsed().some((e) => e.extensionName === 'KHR_draco_mesh_compression')) fail('Draco-compressed models are not supported; decode them first.');
const scene = gltf.getDefaultScene() ?? gltf.listScenes()[0];
if (!scene) fail('no scene in the file');
await doc.transform(dequantize());
// The app poses the aircraft itself: animations, skins and cameras are dropped and the geometry is baked.
for (const x of [...gltf.listAnimations(), ...gltf.listSkins(), ...gltf.listCameras()]) x.dispose();

// Materials: the app lights models with the sun and a plain sky, without reflections of the surroundings, so fully
// metallic surfaces render nearly black; and untextured "paint" in a modelling tool's default light grey looks dirty
// next to white aircraft. Tone both down. Textured and coloured materials keep their colour.
for (const m of gltf.listMaterials()) {
  if (m.getMetallicFactor() > 0.3) m.setMetallicFactor(0.3).setRoughnessFactor(Math.max(m.getRoughnessFactor(), 0.45));
  const c = m.getBaseColorFactor();
  const lo3 = Math.min(c[0], c[1], c[2]);
  const hi3 = Math.max(c[0], c[1], c[2]);
  if (!m.getBaseColorTexture() && lo3 >= 0.7 && hi3 - lo3 <= 0.08 && hi3 < 0.97) m.setBaseColorFactor([(c[0] / hi3) * 0.97, (c[1] / hi3) * 0.97, (c[2] / hi3) * 0.97, c[3]]);
}

/** One source primitive with its vertices in the source world frame. */
interface Part {
  prim: Primitive;
  material: Material | null;
  pos: Float32Array;
  nrm?: Float32Array;
  idx: Uint32Array;
  gearForced: boolean;
}
const underGear = (n: Node): boolean => {
  for (let p: Node | null = n; p; p = p.getParentNode()) if (a['gear-node'] && p.getName() === a['gear-node']) return true;
  return false;
};
if (a['gear-node'] && !gltf.listNodes().some((n) => n.getName() === a['gear-node'])) fail(`no node named "${a['gear-node']}"`);
function collect(sc: Scene): Part[] {
 const parts: Part[] = [];
 sc.traverse((node) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  const w = node.getWorldMatrix();
  // Normals transform with the inverse transpose; a mirrored node flips the triangle winding.
  const m = [w[0], w[4], w[8], w[1], w[5], w[9], w[2], w[6], w[10]];
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const it = [m[4] * m[8] - m[5] * m[7], m[5] * m[6] - m[3] * m[8], m[3] * m[7] - m[4] * m[6], m[2] * m[7] - m[1] * m[8], m[0] * m[8] - m[2] * m[6], m[1] * m[6] - m[0] * m[7], m[1] * m[5] - m[2] * m[4], m[2] * m[3] - m[0] * m[5], m[0] * m[4] - m[1] * m[3]].map((v) => v / (det || 1));
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION');
    if (!P || prim.getMode() !== 4) continue;
    const n = P.getCount();
    const pos = new Float32Array(n * 3);
    const el: number[] = [];
    for (let i = 0; i < n; i++) {
      P.getElement(i, el);
      pos[i * 3] = w[0] * el[0] + w[4] * el[1] + w[8] * el[2] + w[12];
      pos[i * 3 + 1] = w[1] * el[0] + w[5] * el[1] + w[9] * el[2] + w[13];
      pos[i * 3 + 2] = w[2] * el[0] + w[6] * el[1] + w[10] * el[2] + w[14];
    }
    const N = prim.getAttribute('NORMAL');
    let nrm: Float32Array | undefined;
    if (N) {
      nrm = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        N.getElement(i, el);
        const x = it[0] * el[0] + it[1] * el[1] + it[2] * el[2];
        const y = it[3] * el[0] + it[4] * el[1] + it[5] * el[2];
        const z = it[6] * el[0] + it[7] * el[1] + it[8] * el[2];
        const l = Math.hypot(x, y, z) || 1;
        nrm.set([x / l, y / l, z / l], i * 3);
      }
    }
    const I = prim.getIndices();
    const idx = new Uint32Array(I ? I.getCount() : n);
    for (let i = 0; i < idx.length; i++) idx[i] = I ? I.getScalar(i) : i;
    if (det < 0) for (let t = 0; t + 2 < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    parts.push({ prim, material: prim.getMaterial(), pos, nrm, idx: idx.subarray(0, idx.length - (idx.length % 3)), gearForced: underGear(node) });
  }
 });
 return parts;
}
const parts = collect(scene);
if (!parts.length) fail('no triangle meshes in the file');

// Orientation: given, or detected from the shape.
const total = parts.reduce((s, p) => s + p.pos.length, 0);
const cloud = new Float32Array(total);
let off = 0;
for (const p of parts) {
  cloud.set(p.pos, off);
  off += p.pos.length;
}
const axes = a.forward ? { fwd: axis(a.forward), up: axis(a.up!) } : detectAxes(cloud);
const { fwd, up } = axes;
if (fwd.some((v, i) => v !== 0 && up[i] !== 0)) fail('--forward and --up must be different axes');
// Rows of R are the app's axes (X = left, Y = up, Z = forward) in source coordinates: target = R · source.
const left: V = [up[1] * fwd[2] - up[2] * fwd[1], up[2] * fwd[0] - up[0] * fwd[2], up[0] * fwd[1] - up[1] * fwd[0]];
const R = [left, up, fwd];
const rotate = (arr: Float32Array) => {
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i];
    const y = arr[i + 1];
    const z = arr[i + 2];
    for (let r = 0; r < 3; r++) arr[i + r] = R[r][0] * x + R[r][1] * y + R[r][2] * z;
  }
};
const lo: V = [Infinity, Infinity, Infinity];
const hi: V = [-Infinity, -Infinity, -Infinity];
for (const p of parts) {
  rotate(p.pos);
  if (p.nrm) rotate(p.nrm);
  for (let i = 0; i < p.pos.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], p.pos[i]);
    hi[i % 3] = Math.max(hi[i % 3], p.pos[i]);
  }
}
const generated = manifest.models[manifest.types[types[0]] ?? ''];
const generatedBase = generated?.source === 'generated' ? generated : Object.values(manifest.models).find((m) => m.source === 'generated' && m.file === `types/${types[0].toLowerCase()}.glb`);
const targetLength = a.length ? Number(a.length) : (generatedBase ?? generated)?.length;
if (!targetLength || !(hi[2] - lo[2] > 0)) fail('cannot determine the length; pass --length <metres>');
const k = targetLength! / (hi[2] - lo[2]);
const shift: V = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
for (const p of parts) for (let i = 0; i < p.pos.length; i++) p.pos[i] = (p.pos[i] + shift[i % 3]) * k;

// Paint zones and landing gear from the shape.
const replica = airlines.length > 0;
const an = analyse(parts as MeshIn[]);
const wantPaint = a.paint === 'auto' && !replica && an.counts.fuselage > 0;
const gearTris = parts.map((p, i) => (p.gearForced ? new Uint8Array(p.idx.length / 3).fill(1) : a.gear === 'auto' ? an.meshes[i].gearTri : new Uint8Array(p.idx.length / 3)));
let hasGear = gearTris.some((g) => g.includes(1));

// A model drawn without wheels would sit on its belly at the gate. Borrow the landing gear of the generated model
// of the same type (same real dimensions) and lift the body so the two fuselage centrelines are level.
let graft: { from: Document; node: Node } | undefined;
let raise = 0;
if (!hasGear && a.gear === 'auto' && generatedBase?.gear) {
  const from = await io.read(join(root, 'public', 'models', generatedBase.file));
  await from.transform(dequantize());
  const fromScene = from.getRoot().getDefaultScene() ?? from.getRoot().listScenes()[0];
  const node = from.getRoot().listNodes().find((n) => n.getName() === 'gear');
  if (node) {
    raise = Math.max(0, analyse(collect(fromScene) as MeshIn[]).axisY - an.axisY);
    for (const p of parts) for (let i = 1; i < p.pos.length; i += 3) p.pos[i] += raise;
    graft = { from, node };
    hasGear = true;
  }
}

// Rebuild the scene: baked geometry under two nodes, body and gear.
const buffer = gltf.listBuffers()[0] ?? doc.createBuffer();
const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3', array: Float32Array | Uint32Array): Accessor => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const bodyMesh = doc.createMesh('body');
const gearMesh = doc.createMesh('gear');
parts.forEach((p, i) => {
  // The analysis splits vertices where paint zones meet; every attribute follows that mapping.
  const z = an.meshes[i];
  const take = (arr: Float32Array, size: number) => {
    const o = new Float32Array(z.src.length * size);
    for (let v = 0; v < z.src.length; v++) for (let c = 0; c < size; c++) o[v * size + c] = arr[z.src[v] * size + c];
    return o;
  };
  const attrs: [string, Accessor][] = [['POSITION', acc('VEC3', take(p.pos, 3))]];
  if (p.nrm) attrs.push(['NORMAL', acc('VEC3', take(p.nrm, 3))]);
  for (const sem of p.prim.listSemantics()) {
    if (!/^(TEXCOORD|COLOR)_\d+$/.test(sem)) continue;
    const srcAcc = p.prim.getAttribute(sem)!;
    const size = srcAcc.getElementSize();
    const flat = new Float32Array(srcAcc.getCount() * size);
    const el: number[] = [];
    for (let v = 0; v < srcAcc.getCount(); v++) flat.set(srcAcc.getElement(v, el), v * size);
    attrs.push([sem, doc.createAccessor().setType(srcAcc.getType()).setArray(take(flat, size)).setBuffer(buffer)]);
  }
  if (wantPaint) attrs.push(['_LIVERY', acc('SCALAR', z.zone)], ['_PAINT', acc('VEC2', z.paint)]);
  const g = gearTris[i];
  const pick = (want: number) => {
    const out: number[] = [];
    for (let t = 0; t < g.length; t++) if (g[t] === want) out.push(z.idx[t * 3], z.idx[t * 3 + 1], z.idx[t * 3 + 2]);
    return new Uint32Array(out);
  };
  const split = g.includes(1) && g.includes(0);
  for (const [want, mesh] of [[0, bodyMesh], [1, gearMesh]] as const) {
    const idx = pick(want);
    if (!idx.length) continue;
    const prim = doc.createPrimitive().setMaterial(p.material).setIndices(acc('SCALAR', idx));
    for (const [sem, ac] of attrs) prim.setAttribute(sem, ac);
    if (split) compactPrimitive(prim);
    mesh.addPrimitive(prim);
  }
});
for (const n of gltf.listNodes()) n.dispose();
const outer = doc.createNode('aircraft');
outer.addChild(doc.createNode('body').setMesh(bodyMesh));
if (graft) {
  const gear = copyToDocument(doc, graft.from, [graft.node]).get(graft.node) as Node;
  // Every primitive needs the paint attributes the shader reads (zone 0 = unpainted).
  gear.traverse((n) => {
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      const count = prim.getAttribute('POSITION')!.getCount();
      for (const sem of prim.listSemantics()) if (sem.startsWith('_')) prim.setAttribute(sem, null);
      if (wantPaint) prim.setAttribute('_LIVERY', acc('SCALAR', new Float32Array(count))).setAttribute('_PAINT', acc('VEC2', new Float32Array(count * 2)));
    }
  });
  outer.addChild(gear);
} else if (hasGear) outer.addChild(doc.createNode('gear').setMesh(gearMesh));
scene.addChild(outer);
for (const ac of gltf.listAccessors()) ac.setBuffer(buffer);
for (const bf of gltf.listBuffers()) if (bf !== buffer) bf.dispose();

await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
doc.createExtension(EXTMeshoptCompression).setRequired(true);
const glb = await io.writeBinary(doc);
const report = () => {
  const sign = (v: V) => `${v[v.findIndex((x) => x !== 0)] < 0 ? '-' : '+'}${'xyz'[v.findIndex((x) => x !== 0)]}`;
  console.log(`  axes: forward ${sign(fwd)}, up ${sign(up)}${a.forward ? '' : ' (detected)'}; fuselage radius ${round(an.radius)} m, axis ${round(an.axisY)} m above ground`);
  console.log(`  paint: ${wantPaint ? `${an.counts.fuselage} fuselage, ${an.counts.tail} fin/winglet, ${an.counts.engine} cowl triangles (${an.counts.nacelles} cowls)` : 'off'}; gear: ${graft ? `none in the model, borrowed from ${generatedBase!.file} (body raised ${round(raise)} m)` : hasGear ? `${gearTris.reduce((s, g) => s + g.reduce((x, y) => x + y, 0), 0)} triangles retract` : 'fixed'}`);
};
if (a.preview) {
  // Trial run: write the converted model somewhere else and leave the app untouched.
  writeFileSync(a.preview, glb);
  console.log(`Preview ${a.preview}: ${(glb.length / 1024).toFixed(0)} KiB, ${round(an.length)} m long, ${round(an.span)} m span, ${round(an.height + raise)} m high`);
  report();
  process.exit(0);
}
const outDir = join(root, 'public', 'models', 'licensed');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${a.id}.glb`), glb);

// Navigation and landing light positions: taken from the generated model of the same type (same real aircraft).
const lights = (generatedBase ?? generated)?.lights;
manifest.models[a.id!] = {
  file: `licensed/${a.id}.glb`,
  rev: createHash('sha256').update(glb).digest('hex').slice(0, 10),
  name: a.name!,
  cls: generated?.cls ?? modelClassFor(types[0]),
  length: round(an.length),
  span: round(an.span),
  height: round(an.height + raise),
  livery: wantPaint,
  ...(wantPaint ? { paintAttr: true } : {}),
  gear: hasGear,
  ...(lights ? { lights } : {}),
  source: 'licensed',
  licence: a.licence,
  author: a.author,
  url: a.url,
  ...(airlines.length ? { airline: airlines.join(',') } : {}),
};
if (airlines.length) {
  manifest.liveries ??= {};
  for (const al of airlines) for (const t of types) (manifest.liveries[al] ??= {})[t] = a.id!;
} else {
  for (const t of types) manifest.types[t] = a.id!;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
const row = `| \`public/models/licensed/${a.id}.glb\` (${a.name}; used for ${types.join(', ')}${airlines.length ? ` operated by ${airlines.join(', ')}` : ''}) | ${a.author}, ${a.url} | ${a.licence} | ${/^CC0/i.test(a.licence!) ? 'No' : `Yes: "${a.name}" by ${a.author} (${a.licence}) — listed on the Data sources page`} |\n`;
const licPath = join(root, 'ASSETS_LICENSES.md');
const lic = readFileSync(licPath, 'utf8');
const marker = `| \`public/models/licensed/${a.id}.glb\` `;
// Re-importing the same id replaces its row instead of adding a second one.
if (lic.includes(marker)) writeFileSync(licPath, lic.split('\n').map((l) => (l.startsWith(marker) ? row.trimEnd() : l)).join('\n'));
else appendFileSync(licPath, row);
console.log(`Imported ${a.id}: ${(glb.length / 1024).toFixed(0)} KiB, ${round(an.length)} m long, ${round(an.span)} m span, ${round(an.height)} m high → ${types.join(', ')}${airlines.length ? ` (${airlines.join(', ')} only)` : ''}`);
report();
console.log('Now add the author credit to public/legal/sources.html (CC-BY requires it) and check the model with `npm run dev`.');

function round(n: number) {
  return Math.round(n * 100) / 100;
}
function fail(msg: string): never {
  console.error(`import-model: ${msg}`);
  process.exit(1);
}
