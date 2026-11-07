import { describe, expect, it } from 'vitest';
import { detectPhase, type PhaseMemory } from './phase';
import { airportIndex } from './airportData';
import { defaultScriptedFlights, scriptedState } from './simulator';
import type { FlightPhase } from './types';

const airports = airportIndex();
const flights = defaultScriptedFlights(airports);

/** Run a scripted flight through the detector at 1 Hz and return the distinct phase sequence. */
function sequence(callsign: string): FlightPhase[] {
  const f = flights.find((x) => x.callsign === callsign)!;
  const start = (f.periodS - f.offsetS) * 1000; // local time 0 of the script
  let mem: PhaseMemory | undefined;
  const out: FlightPhase[] = [];
  for (let s = 0; s < f.periodS; s++) {
    const t = start + s * 1000;
    const st = scriptedState(f, t);
    if (!st) continue;
    const r = detectPhase(
      { t, lat: st.lat, lon: st.lon, onGround: st.onGround, altFt: st.altBaro, gsKt: st.gs, vrateFpm: st.vrate, track: st.track },
      airports,
      mem,
    );
    mem = r.memory;
    if (out[out.length - 1] !== r.phase) out.push(r.phase);
  }
  return out;
}

describe('detectPhase', () => {
  it('scripted arrival into DEL 28: approach → landing → ground', () => {
    const seq = sequence('SKV101');
    expect(['approach', 'descent']).toContain(seq[0]);
    expect(seq).toContain('approach');
    expect(seq).toContain('landing');
    expect(seq.indexOf('landing')).toBeGreaterThan(seq.indexOf('approach'));
    expect(seq[seq.length - 1]).toBe('ground');
    expect(seq).not.toContain('takeoff_roll');
    expect(seq).not.toContain('climb');
  });

  it('scripted departure from BOM 27: ground → takeoff roll → climb', () => {
    const seq = sequence('SKV202');
    expect(seq.slice(0, 3)).toEqual(['ground', 'takeoff_roll', 'climb']);
    expect(seq).not.toContain('approach');
    expect(seq).not.toContain('landing');
  });

  it('matches the landing runway', () => {
    const f = flights.find((x) => x.callsign === 'SKV101')!;
    const t = (f.periodS - f.offsetS) * 1000 + 200_000;
    const st = scriptedState(f, t)!;
    const r = detectPhase({ t, lat: st.lat, lon: st.lon, onGround: false, altFt: st.altBaro, gsKt: st.gs, vrateFpm: st.vrate, track: st.track }, airports);
    expect(r.runway?.airport.ident).toBe('VIDP');
    expect(r.runway?.end.ident).toBe('28');
    expect(r.aglFt).toBeGreaterThan(500);
  });

  it('cruise, climb and descent away from airports', () => {
    const base = { t: 0, lat: 23.5, lon: 80.0, onGround: false, gsKt: 460, track: 30 };
    expect(detectPhase({ ...base, altFt: 37000, vrateFpm: 0 }, airports).phase).toBe('cruise');
    expect(detectPhase({ ...base, altFt: 21000, vrateFpm: 2200 }, airports).phase).toBe('climb');
    expect(detectPhase({ ...base, altFt: 21000, vrateFpm: -1800 }, airports).phase).toBe('descent');
  });

  it('debounces noisy vertical rates', () => {
    const base = { lat: 23.5, lon: 80.0, onGround: false, gsKt: 460, track: 30, altFt: 35000 };
    let r = detectPhase({ ...base, t: 0, vrateFpm: 0 }, airports);
    r = detectPhase({ ...base, t: 1000, vrateFpm: -600 }, airports, r.memory); // one noisy sample
    expect(r.phase).toBe('cruise');
    r = detectPhase({ ...base, t: 2000, vrateFpm: 0 }, airports, r.memory);
    expect(r.phase).toBe('cruise');
    for (let t = 3000; t <= 7000; t += 1000) r = detectPhase({ ...base, t, vrateFpm: -1500 }, airports, r.memory);
    expect(r.phase).toBe('descent');
  });

  it('a stationary aircraft at the gate is on the ground', () => {
    const r = detectPhase({ t: 0, lat: 28.5562, lon: 77.0868, onGround: true, gsKt: 0, track: 120 }, airports);
    expect(r.phase).toBe('ground');
  });
});
