import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allModels, modelUrl } from '../shared/aircraftModels';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('generated model files', () => {
  it('every manifest entry points at a GLB that exists, is versioned, and uses the app conventions', () => {
    const models = Object.entries(allModels());
    expect(models.length).toBeGreaterThan(40);
    for (const [id, e] of models) {
      const path = join(root, 'public', 'models', e.file);
      expect(existsSync(path), id).toBe(true);
      expect(modelUrl(e)).toMatch(/^\/models\/.+\.glb(\?v=[0-9a-f]+)?$/);
      const glb = readFileSync(path);
      expect(glb.readUInt32LE(0), id).toBe(0x46546c67); // "glTF"
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
        nodes: { name?: string }[];
        meshes: { primitives: { attributes: Record<string, number> }[] }[];
      };
      if (e.gear) expect(json.nodes.some((n) => n.name === 'gear'), id).toBe(true);
      if (e.livery) for (const m of json.meshes) for (const p of m.primitives) expect(p.attributes._LIVERY, id).toBeTypeOf('number');
    }
  });
});
