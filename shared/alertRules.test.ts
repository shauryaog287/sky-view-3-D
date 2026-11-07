import { describe, expect, it } from 'vitest';
import { alertTriggered } from './alertRules';

describe('alertTriggered', () => {
  it('descent fires once when leaving cruise (and for an already-descending flight)', () => {
    expect(alertTriggered('descent', 'cruise', 'descent')).toBe(true);
    expect(alertTriggered('descent', 'descent', 'descent')).toBe(false);
    expect(alertTriggered('descent', undefined, 'descent')).toBe(true);
    expect(alertTriggered('descent', 'climb', 'cruise')).toBe(false);
  });

  it('descent respects the destination airport filter', () => {
    expect(alertTriggered('descent', 'cruise', 'descent', { airportMatch: false })).toBe(false);
    expect(alertTriggered('descent', 'cruise', 'descent', { airportMatch: true })).toBe(true);
    expect(alertTriggered('descent', 'cruise', 'descent', { airportMatch: undefined })).toBe(true);
  });

  it('takeoff, approach and landed', () => {
    expect(alertTriggered('takeoff', 'ground', 'takeoff_roll')).toBe(true);
    expect(alertTriggered('takeoff', 'takeoff_roll', 'climb')).toBe(true);
    expect(alertTriggered('takeoff', 'cruise', 'climb')).toBe(false);
    expect(alertTriggered('takeoff', undefined, 'climb', { aglFt: 1200 })).toBe(true);
    expect(alertTriggered('approach', 'descent', 'approach')).toBe(true);
    expect(alertTriggered('approach', 'descent', 'approach', { airportMatch: false })).toBe(false);
    expect(alertTriggered('landed', 'landing', 'ground')).toBe(true);
    expect(alertTriggered('landed', 'landing', 'landing', { onGround: true })).toBe(true);
    expect(alertTriggered('landed', 'approach', 'landing', { onGround: false })).toBe(false);
    expect(alertTriggered('landed', 'ground', 'ground')).toBe(false);
    expect(alertTriggered('landed', 'takeoff_roll', 'ground')).toBe(false);
  });
});
