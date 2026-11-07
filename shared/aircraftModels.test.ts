import { describe, expect, it } from 'vitest';
import { modelEntry, modelIdFor } from './aircraftModels';
import { modelClassFor } from './aircraftTypes';

describe('aircraft model selection', () => {
  it('picks the model of the exact ICAO type', () => {
    expect(modelIdFor('A20N', 'narrowbody')).toBe('a20n');
    expect(modelIdFor('a320', 'narrowbody')).toBe('a320');
    expect(modelIdFor('B77W', 'widebody')).toBe('b77w');
    expect(modelIdFor('B789', 'widebody')).toBe('b789');
    expect(modelIdFor('A388', 'widebody')).toBe('a388');
    expect(modelIdFor('B744', 'widebody')).toBe('b744');
    expect(modelIdFor('AT76', 'turboprop')).toBe('at76');
    expect(modelIdFor('B38M', 'narrowbody')).toBe('b38m');
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
});
