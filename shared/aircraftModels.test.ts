import { describe, expect, it } from 'vitest';
import { modelEntry, modelIdFor, resolveModel, type ModelManifest } from './aircraftModels';
import { modelClassFor } from './aircraftTypes';

describe('aircraft model selection', () => {
  it('prefers an imported model of the type, which must be paintable and credited', () => {
    for (const [type, cls] of [['A320', 'narrowbody'], ['A20N', 'narrowbody'], ['A21N', 'narrowbody'], ['A321', 'narrowbody'], ['B738', 'narrowbody'], ['B38M', 'narrowbody'], ['B789', 'widebody'], ['A388', 'widebody'], ['AT76', 'turboprop'], ['DH8D', 'turboprop'], ['CRJ2', 'regional']] as const) {
      const e = modelEntry(modelIdFor(type, cls));
      expect(e.source).toBe('licensed');
      expect(e.livery && e.paintAttr && e.gear).toBe(true);
      expect(e.lights).toBeDefined();
      expect(e.licence && e.author && e.url).toBeTruthy();
    }
  });
  it('picks the model of the exact ICAO type', () => {
    expect(modelIdFor('A19N', 'narrowbody')).toBe('a19n');
    expect(modelIdFor('a319', 'narrowbody')).toBe('a319');
    expect(modelIdFor('B77W', 'widebody')).toBe('b77w');
    expect(modelIdFor('B788', 'widebody')).toBe('b788');
    expect(modelIdFor('A359', 'widebody')).toBe('a359');
    expect(modelIdFor('B744', 'widebody')).toBe('b744');
    expect(modelIdFor('AT45', 'turboprop')).toBe('at45');
    expect(modelIdFor('B39M', 'narrowbody')).toBe('b39m');
  });

  it('falls back to the class model for unknown types and missing data', () => {
    expect(modelIdFor('ZZZZ', 'widebody')).toBe(modelIdFor(undefined, 'widebody'));
    expect(modelEntry(modelIdFor(undefined, 'helicopter')).cls).toBe('helicopter');
    expect(modelEntry(modelIdFor(undefined, 'generic')).cls).toBe('narrowbody');
    expect(modelEntry('no-such-model').file).toMatch(/\.glb$/);
  });

  it('every type designator of the class table resolves to a model of a sensible size', () => {
    for (const t of ['A319', 'B738', 'E190', 'CRJ9', 'DH8D', 'C172', 'GLF6', 'H145', 'A359', 'B763']) {
      const e = modelEntry(modelIdFor(t, modelClassFor(t)));
      expect(e.length, t).toBeGreaterThan(7);
      expect(e.length, t).toBeLessThan(80);
    }
  });

  it('has real dimensions for the common types', () => {
    expect(modelEntry('a20n').length).toBeCloseTo(37.57, 1);
    expect(modelEntry('b77w').length).toBeCloseTo(73.86, 1);
    expect(modelEntry('a388').span).toBeCloseTo(79.75, 1);
  });

  it("prefers the operator's own replica, then the type model, then the class model", () => {
    const entry = { file: 'x.glb', name: 'x', cls: 'narrowbody', length: 37, span: 35, height: 12, livery: false, gear: false, source: 'licensed' } as const;
    const m: ModelManifest = {
      v: 1,
      models: { a20n: { ...entry, source: 'generated' }, 'a20n-igo': { ...entry, airline: 'IGO' }, b738: { ...entry, source: 'generated' } },
      types: { A20N: 'a20n', B738: 'b738' },
      classes: { narrowbody: 'a20n', widebody: 'a20n', regional: 'a20n', turboprop: 'a20n', bizjet: 'a20n', helicopter: 'a20n', light: 'a20n', generic: 'a20n' },
      liveries: { IGO: { A20N: 'a20n-igo', A21N: 'missing-file' } },
    };
    expect(resolveModel(m, 'A20N', 'narrowbody', 'IGO')).toBe('a20n-igo');
    expect(resolveModel(m, 'A20N', 'narrowbody', 'igo')).toBe('a20n-igo');
    expect(resolveModel(m, 'A20N', 'narrowbody', 'AIC')).toBe('a20n');
    expect(resolveModel(m, 'A20N', 'narrowbody')).toBe('a20n');
    expect(resolveModel(m, 'B738', 'narrowbody', 'IGO')).toBe('b738');
    expect(resolveModel(m, 'A21N', 'narrowbody', 'IGO')).toBe('a20n'); // replica listed but not present → class model
  });
});
