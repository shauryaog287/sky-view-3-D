import { describe, expect, it } from 'vitest';
import { matchesPlan, planSearch } from './search';
import type { AircraftState } from './types';

describe('planSearch', () => {
  it('converts IATA flight numbers to ICAO callsigns', () => {
    expect(planSearch('6E-2134').callsigns[0]).toBe('IGO2134');
    expect(planSearch('6e 2134').callsigns[0]).toBe('IGO2134');
    expect(planSearch('AI 101').callsigns).toContain('AIC101');
    expect(planSearch('UK0955').callsigns[0]).toBe('VTI955');
  });

  it('keeps ICAO callsigns', () => {
    expect(planSearch('igo2132').callsigns).toContain('IGO2132');
  });

  it('detects registrations and hex codes', () => {
    expect(planSearch('VT-NHC').regs).toContain('VT-NHC');
    expect(planSearch('801822').hexes).toContain('801822');
    expect(planSearch('N123AB').regs).toContain('N123AB');
    // "BA1234" is both a valid hex and a flight number.
    const ba = planSearch('BA1234');
    expect(ba.callsigns).toContain('BAW1234');
    expect(ba.hexes).toContain('ba1234');
  });

  it('matches loaded aircraft', () => {
    const a: AircraftState = { hex: '801822', callsign: 'IGO2132', reg: 'VT-NHC', lat: 0, lon: 0, onGround: false, posTs: 0, seenTs: 0, source: 'fixture' };
    expect(matchesPlan(a, planSearch('6E 2132'))).toBe(true);
    expect(matchesPlan(a, planSearch('vtnhc'))).toBe(true);
    expect(matchesPlan(a, planSearch('801822'))).toBe(true);
    expect(matchesPlan(a, planSearch('AI 101'))).toBe(false);
  });
});
