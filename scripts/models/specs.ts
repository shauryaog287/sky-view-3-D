/**
 * Per-type model specifications. Dimensions are public figures (manufacturer airport-planning documents and
 * type-certificate data, rounded); placement details (engine position, gear, doors) are measured from published
 * three-view drawings. Each entry lists the ICAO type designators it is used for.
 */
import type { ModelClass } from '../../shared/aircraftTypes';
import { buildAirliner, type AirlinerSpec, type Built } from './airliner';
import { buildHelicopter, buildLight } from './ga';

export interface ModelDef {
  id: string;
  name: string;
  cls: ModelClass;
  types: string[];
  /** Tail/winglets take the operator's colour. */
  livery: boolean;
  /** Has a retractable "gear" node. */
  gear: boolean;
  build: () => Built;
}

type Patch<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : Patch<T[K]>) : T[K] };
function variant(base: AirlinerSpec, p: Patch<AirlinerSpec>): AirlinerSpec {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...(out[k] as object), ...(v as object) };
    else out[k] = v;
  }
  return out as unknown as AirlinerSpec;
}

const jet = (id: string, name: string, cls: ModelClass, types: string[], spec: AirlinerSpec, tex?: [number, number]): ModelDef => ({
  id,
  name,
  cls,
  types,
  livery: true,
  gear: true,
  build: () => buildAirliner(spec, tex?.[0], tex?.[1]),
});

// ── Airbus A320 family ──────────────────────────────────────────────────────

const A320: AirlinerSpec = {
  L: 37.57, R: 1.975, hR: 1.05, belly: 1.55, nose: 'airbus',
  wing: { span: 34.1, root: 6.7, tip: 1.5, sweep: 27.5, dihedral: 5.1, at: 0.355, pos: 'low', kink: 0.36, tipStyle: 'fence', wingletH: 0.86 },
  engines: [{ kind: 'fan', x: 5.75, dia: 2.0, len: 4.3, fwd: 2.4, drop: 1.32 }],
  fin: { h: 6.1, root: 5.5, tip: 2.0, sweep: 40, aft: 1.0 },
  stab: { span: 12.45, root: 3.5, tip: 1.3, sweep: 32, dihedral: 6, aft: 1.2 },
  gear: { mainX: 3.8, mainWheels: 2, tyre: 0.585, noseFromTip: 5.1, noseTyre: 0.38, mainDz: 0.4 },
  windows: { pitch: 0.533, w: 0.23, h: 0.33, y: 0.17, from: 6.2, to: 30.4 },
  doors: [{ z: 5.0 }, { z: 15.95, kind: 'exit' }, { z: 16.85, kind: 'exit' }, { z: 31.1 }, { z: 8.6, kind: 'cargo' }, { z: 25.4, kind: 'cargo' }],
};
const NEO_ENGINE = { kind: 'fan' as const, x: 5.75, dia: 2.37, len: 4.9, fwd: 2.9, drop: 1.38 };
const A20N = variant(A320, { wing: { tipStyle: 'sharklet', wingletH: 2.43 }, engines: [NEO_ENGINE] });
const A319 = variant(A320, {
  L: 33.84,
  windows: { from: 6.2, to: 26.6 },
  doors: [{ z: 5.0 }, { z: 14.9, kind: 'exit' }, { z: 27.4 }, { z: 8.6, kind: 'cargo' }, { z: 21.9, kind: 'cargo' }],
  wing: { at: 0.37 },
});
const A19N = variant(A319, { wing: { tipStyle: 'sharklet', wingletH: 2.43 }, engines: [NEO_ENGINE] });
const A321 = variant(A320, {
  L: 44.51,
  wing: { at: 0.37, root: 6.9 },
  windows: { from: 6.2, to: 37.4 },
  doors: [{ z: 5.0 }, { z: 11.9 }, { z: 25.9 }, { z: 38.1 }, { z: 8.6, kind: 'cargo' }, { z: 31.5, kind: 'cargo' }],
  gear: { tyre: 0.62, mainDz: 0.6 },
});
const A21N = variant(A321, { wing: { tipStyle: 'sharklet', wingletH: 2.43 }, engines: [NEO_ENGINE] });

// ── Airbus A220 ─────────────────────────────────────────────────────────────

const BCS1: AirlinerSpec = {
  L: 35.0, R: 1.85, hR: 1.03, belly: 1.3, nose: 'a220',
  wing: { span: 35.1, root: 6.3, tip: 1.25, sweep: 27, dihedral: 5, at: 0.37, pos: 'low', kink: 0.33, tipStyle: 'small', wingletH: 1.0 },
  engines: [{ kind: 'fan', x: 5.0, dia: 2.15, len: 4.3, fwd: 2.6, drop: 1.2 }],
  fin: { h: 6.0, root: 5.4, tip: 2.3, sweep: 38, aft: 0.9 },
  stab: { span: 12.4, root: 3.2, tip: 1.2, sweep: 32, dihedral: 6, aft: 1.0 },
  gear: { mainX: 3.4, mainWheels: 2, tyre: 0.56, noseFromTip: 4.5, noseTyre: 0.36, mainDz: 0.3 },
  windows: { pitch: 0.53, w: 0.28, h: 0.4, y: 0.16, from: 5.6, to: 29.6 },
  doors: [{ z: 4.4 }, { z: 15.3, kind: 'exit' }, { z: 30.3 }],
};
const BCS3 = variant(BCS1, { L: 38.7, windows: { to: 33.2 }, doors: [{ z: 4.4 }, { z: 16.2, kind: 'exit' }, { z: 17.1, kind: 'exit' }, { z: 33.9 }], wing: { at: 0.38 } });

// ── Boeing 737 ──────────────────────────────────────────────────────────────

const B738: AirlinerSpec = {
  L: 39.47, R: 1.88, hR: 1.07, belly: 1.0, nose: 'b737',
  wing: { span: 34.3, root: 6.2, tip: 1.25, sweep: 27, dihedral: 6, at: 0.375, pos: 'low', kink: 0.37, tipStyle: 'blended', wingletH: 2.5 },
  engines: [{ kind: 'fan', x: 4.9, dia: 1.88, len: 3.7, fwd: 2.0, drop: 0.98 }],
  fin: { h: 7.25, root: 6.0, tip: 1.9, sweep: 36, aft: 0.9 },
  stab: { span: 14.35, root: 3.7, tip: 1.2, sweep: 32, dihedral: 7, aft: 1.0 },
  gear: { mainX: 2.86, mainWheels: 2, tyre: 0.56, noseFromTip: 4.3, noseTyre: 0.34, mainDz: 0.5 },
  windows: { pitch: 0.508, w: 0.25, h: 0.35, y: 0.18, from: 5.9, to: 32.8 },
  doors: [{ z: 4.6 }, { z: 17.6, kind: 'exit' }, { z: 18.45, kind: 'exit' }, { z: 33.6 }, { z: 9.2, kind: 'cargo' }, { z: 27.0, kind: 'cargo' }],
};
const B737 = variant(B738, {
  L: 33.63,
  windows: { to: 27.0 },
  doors: [{ z: 4.6 }, { z: 15.1, kind: 'exit' }, { z: 27.8 }, { z: 9.2, kind: 'cargo' }, { z: 22.0, kind: 'cargo' }],
  wing: { at: 0.39 },
});
const B739 = variant(B738, {
  L: 42.11,
  windows: { to: 35.3 },
  doors: [{ z: 4.6 }, { z: 17.6, kind: 'exit' }, { z: 18.45, kind: 'exit' }, { z: 30.0, kind: 'exit' }, { z: 36.2 }, { z: 9.2, kind: 'cargo' }, { z: 29.0, kind: 'cargo' }],
  wing: { at: 0.37 },
});
const MAX_ENGINE = { kind: 'fan' as const, x: 4.9, dia: 2.1, len: 4.2, fwd: 2.5, drop: 0.92 };
const B38M = variant(B738, { wing: { span: 34.3, tipStyle: 'split', wingletH: 2.0 }, engines: [MAX_ENGINE] });
const B37M = variant(B737, { L: 35.56, windows: { to: 28.9 }, doors: [{ z: 4.6 }, { z: 15.9, kind: 'exit' }, { z: 29.7 }], wing: { tipStyle: 'split', wingletH: 2.0 }, engines: [MAX_ENGINE] });
const B39M = variant(B739, { L: 42.16, wing: { tipStyle: 'split', wingletH: 2.0 }, engines: [MAX_ENGINE] });

// ── Boeing 757 / 767 ────────────────────────────────────────────────────────

const B752: AirlinerSpec = {
  L: 47.32, R: 1.88, hR: 1.07, belly: 1.55, nose: 'b757',
  wing: { span: 38.05, root: 7.6, tip: 1.6, sweep: 27, dihedral: 6, at: 0.38, pos: 'low', kink: 0.33, tipStyle: 'blended', wingletH: 2.6 },
  engines: [{ kind: 'fan', x: 6.4, dia: 2.25, len: 4.7, fwd: 2.4, drop: 1.25 }],
  fin: { h: 7.9, root: 6.4, tip: 2.2, sweep: 38, aft: 1.0 },
  stab: { span: 15.2, root: 4.2, tip: 1.4, sweep: 33, dihedral: 7, aft: 1.0 },
  gear: { mainX: 3.66, mainWheels: 4, tyre: 0.57, noseFromTip: 4.8, noseTyre: 0.38, mainDz: 0.6 },
  windows: { pitch: 0.508, w: 0.25, h: 0.35, y: 0.18, from: 6.2, to: 40.5 },
  doors: [{ z: 5.0 }, { z: 11.6 }, { z: 21.8, kind: 'exit' }, { z: 22.7, kind: 'exit' }, { z: 33.6 }, { z: 41.5 }, { z: 8.6, kind: 'cargo' }, { z: 33.0, kind: 'cargo' }],
};
const B763: AirlinerSpec = {
  L: 54.94, R: 2.515, hR: 1.075, belly: 1.75, nose: 'b767',
  wing: { span: 47.57, root: 9.2, tip: 2.3, sweep: 33, dihedral: 6, at: 0.38, pos: 'low', kink: 0.32, tipStyle: 'blended', wingletH: 3.4 },
  engines: [{ kind: 'fan', x: 7.6, dia: 2.75, len: 6.0, fwd: 2.8, drop: 1.55 }],
  fin: { h: 9.0, root: 8.0, tip: 2.6, sweep: 40, aft: 1.1 },
  stab: { span: 18.62, root: 5.0, tip: 1.6, sweep: 34, dihedral: 7, aft: 1.2 },
  gear: { mainX: 4.65, mainWheels: 4, tyre: 0.6, noseFromTip: 6.4, noseTyre: 0.45, mainDz: 0.8 },
  windows: { pitch: 0.508, w: 0.25, h: 0.36, y: 0.14, from: 7.0, to: 47.0 },
  doors: [{ z: 5.8 }, { z: 25.4, kind: 'exit' }, { z: 26.3, kind: 'exit' }, { z: 48.2 }, { z: 10.0, kind: 'cargo' }, { z: 39.0, kind: 'cargo' }],
};

// ── Boeing 777 ──────────────────────────────────────────────────────────────

const B77W: AirlinerSpec = {
  L: 73.86, R: 3.1, hR: 1.0, belly: 2.2, nose: 'b777',
  wing: { span: 64.8, root: 12.6, tip: 2.6, sweep: 33, dihedral: 6, at: 0.375, pos: 'low', kink: 0.3, tipStyle: 'raked' },
  engines: [{ kind: 'fan', x: 9.6, dia: 3.9, len: 7.3, fwd: 3.9, drop: 1.95 }],
  fin: { h: 10.5, root: 10.4, tip: 3.2, sweep: 40, aft: 1.4 },
  stab: { span: 21.5, root: 6.3, tip: 2.0, sweep: 35, dihedral: 7, aft: 1.6 },
  gear: { mainX: 5.5, mainWheels: 6, tyre: 0.66, noseFromTip: 7.2, noseTyre: 0.55, mainDz: 1.2 },
  windows: { pitch: 0.53, w: 0.25, h: 0.38, y: 0.12, from: 8.4, to: 66.0 },
  doors: [{ z: 7.0 }, { z: 17.4 }, { z: 36.9 }, { z: 52.6 }, { z: 66.9 }, { z: 12.5, kind: 'cargo' }, { z: 55.0, kind: 'cargo' }],
};
const B772 = variant(B77W, {
  L: 63.73,
  wing: { span: 60.93, tipStyle: 'none' },
  engines: [{ kind: 'fan', x: 9.6, dia: 3.45, len: 6.6, fwd: 3.6, drop: 1.85 }],
  windows: { to: 56.0 },
  doors: [{ z: 7.0 }, { z: 17.1 }, { z: 32.4 }, { z: 56.8 }, { z: 12.5, kind: 'cargo' }, { z: 46.0, kind: 'cargo' }],
  gear: { mainDz: 0.9 },
});
const B77L = variant(B772, { wing: { span: 64.8, tipStyle: 'raked' }, engines: [{ kind: 'fan', x: 9.6, dia: 3.9, len: 7.3, fwd: 3.9, drop: 1.95 }] });
const B779 = variant(B77W, {
  L: 76.72,
  wing: { span: 71.75, root: 12.8, tip: 2.3, tipStyle: 'raked' },
  engines: [{ kind: 'fan', x: 10.3, dia: 4.4, len: 7.6, fwd: 4.2, drop: 2.0 }],
  windows: { pitch: 0.56, h: 0.42, to: 68.8 },
  doors: [{ z: 7.0 }, { z: 18.0 }, { z: 38.0 }, { z: 54.4 }, { z: 69.7 }, { z: 12.5, kind: 'cargo' }, { z: 57.0, kind: 'cargo' }],
});

// ── Boeing 787 ──────────────────────────────────────────────────────────────

const B789: AirlinerSpec = {
  L: 62.81, R: 2.885, hR: 1.03, belly: 2.0, nose: 'b787',
  wing: { span: 60.12, root: 11.0, tip: 1.9, sweep: 34, dihedral: 7, at: 0.385, pos: 'low', kink: 0.3, tipStyle: 'raked' },
  engines: [{ kind: 'fan', x: 9.8, dia: 3.3, len: 5.9, fwd: 3.3, drop: 1.7 }],
  fin: { h: 9.1, root: 9.6, tip: 3.0, sweep: 41, aft: 1.3 },
  stab: { span: 19.8, root: 5.7, tip: 1.7, sweep: 35, dihedral: 7, aft: 1.4 },
  gear: { mainX: 4.9, mainWheels: 4, tyre: 0.63, noseFromTip: 6.6, noseTyre: 0.5, mainDz: 1.0 },
  windows: { pitch: 0.6, w: 0.28, h: 0.46, y: 0.12, from: 7.8, to: 55.0 },
  doors: [{ z: 6.6 }, { z: 15.6 }, { z: 38.6 }, { z: 55.8 }, { z: 11.5, kind: 'cargo' }, { z: 46.0, kind: 'cargo' }],
};
const B788 = variant(B789, {
  L: 56.72,
  windows: { to: 49.0 },
  doors: [{ z: 6.6 }, { z: 15.6 }, { z: 35.2 }, { z: 49.8 }, { z: 11.5, kind: 'cargo' }, { z: 41.0, kind: 'cargo' }],
  wing: { at: 0.39 },
});
const B78X = variant(B789, {
  L: 68.28,
  windows: { to: 60.5 },
  doors: [{ z: 6.6 }, { z: 18.6 }, { z: 41.2 }, { z: 61.3 }, { z: 11.5, kind: 'cargo' }, { z: 50.0, kind: 'cargo' }],
  wing: { at: 0.38 },
});

// ── Boeing 747 ──────────────────────────────────────────────────────────────

const B744: AirlinerSpec = {
  L: 70.66, R: 3.25, hR: 1.08, belly: 2.35, nose: 'b747', noseLen: 2.4,
  wing: { span: 61.0, root: 14.5, tip: 3.6, sweep: 40, dihedral: 7, at: 0.33, pos: 'low', kink: 0.3, tipStyle: 'canted', wingletH: 1.8 },
  engines: [
    { kind: 'fan', x: 11.9, dia: 2.7, len: 5.9, fwd: 3.3, drop: 1.65 },
    { kind: 'fan', x: 21.0, dia: 2.7, len: 5.9, fwd: 2.9, drop: 1.5 },
  ],
  fin: { h: 10.4, root: 11.0, tip: 3.6, sweep: 46, aft: 1.4 },
  stab: { span: 22.2, root: 7.3, tip: 2.3, sweep: 38, dihedral: 7, aft: 1.5 },
  gear: { mainX: 5.9, mainWheels: 4, tyre: 0.62, noseFromTip: 8.0, noseTyre: 0.6, mainDz: -0.6, body: { x: 1.9, wheels: 4, dz: -3.0 } },
  windows: { pitch: 0.508, w: 0.25, h: 0.36, y: 0.08, from: 7.0, to: 62.0, upper: { y: 1.12, from: 10.2, to: 20.5 } },
  doors: [{ z: 6.4 }, { z: 15.6 }, { z: 27.4 }, { z: 44.5 }, { z: 60.0 }, { z: 11.5, kind: 'cargo' }, { z: 52.0, kind: 'cargo' }, { z: 21.4, deck: 'upper', kind: 'exit' }],
  hump: { to: 27.5, h: 1.85 },
};
const B748 = variant(B744, {
  L: 76.25,
  wing: { span: 68.4, root: 15.2, tip: 2.8, tipStyle: 'raked' },
  engines: [
    { kind: 'fan', x: 12.3, dia: 3.1, len: 6.3, fwd: 3.5, drop: 1.8 },
    { kind: 'fan', x: 22.0, dia: 3.1, len: 6.3, fwd: 3.1, drop: 1.6 },
  ],
  windows: { to: 67.0, upper: { y: 1.12, from: 10.2, to: 24.6 } },
  doors: [{ z: 6.4 }, { z: 15.6 }, { z: 30.8 }, { z: 48.0 }, { z: 65.0 }, { z: 11.5, kind: 'cargo' }, { z: 57.0, kind: 'cargo' }, { z: 25.5, deck: 'upper', kind: 'exit' }],
  hump: { to: 31.6, h: 1.85 },
});

// ── Airbus widebodies ───────────────────────────────────────────────────────

const A333: AirlinerSpec = {
  L: 63.66, R: 2.82, hR: 1.0, belly: 2.0, nose: 'airbus',
  wing: { span: 57.6, root: 11.0, tip: 2.0, sweep: 32, dihedral: 5.5, at: 0.38, pos: 'low', kink: 0.32, tipStyle: 'canted', wingletH: 2.7 },
  engines: [{ kind: 'fan', x: 9.37, dia: 2.95, len: 6.0, fwd: 3.1, drop: 1.75 }],
  fin: { h: 9.6, root: 9.5, tip: 3.3, sweep: 42, aft: 1.4 },
  stab: { span: 19.4, root: 5.8, tip: 2.0, sweep: 33, dihedral: 6, aft: 1.6 },
  gear: { mainX: 5.35, mainWheels: 4, tyre: 0.63, noseFromTip: 6.9, noseTyre: 0.5, mainDz: 1.0 },
  windows: { pitch: 0.533, w: 0.23, h: 0.33, y: 0.14, from: 8.0, to: 53.0 },
  doors: [{ z: 6.9 }, { z: 18.1 }, { z: 38.2, kind: 'exit' }, { z: 53.8 }, { z: 12.5, kind: 'cargo' }, { z: 45.0, kind: 'cargo' }],
};
const A332 = variant(A333, {
  L: 58.82,
  windows: { to: 48.2 },
  doors: [{ z: 6.9 }, { z: 15.6 }, { z: 34.0, kind: 'exit' }, { z: 49.0 }, { z: 12.5, kind: 'cargo' }, { z: 41.0, kind: 'cargo' }],
  wing: { at: 0.39 },
});
const A339 = variant(A333, { wing: { span: 60.0, tipStyle: 'curved', wingletH: 3.0 }, engines: [{ kind: 'fan', x: 9.4, dia: 3.35, len: 6.3, fwd: 3.4, drop: 1.8 }] });
const A343 = variant(A333, {
  engines: [
    { kind: 'fan', x: 10.0, dia: 2.2, len: 5.0, fwd: 2.6, drop: 1.35 },
    { kind: 'fan', x: 17.4, dia: 2.2, len: 5.0, fwd: 2.3, drop: 1.2 },
  ],
});
const A346 = variant(A333, {
  L: 75.36,
  wing: { span: 60.6, root: 12.0 },
  engines: [
    { kind: 'fan', x: 10.4, dia: 2.95, len: 6.0, fwd: 3.0, drop: 1.6 },
    { kind: 'fan', x: 18.6, dia: 2.95, len: 6.0, fwd: 2.6, drop: 1.4 },
  ],
  windows: { to: 64.5 },
  doors: [{ z: 6.9 }, { z: 19.2 }, { z: 40.4, kind: 'exit' }, { z: 51.0 }, { z: 65.4 }],
  gear: { body: { x: 0.01, wheels: 4, dz: -2.6 } },
});
const A359: AirlinerSpec = {
  L: 66.8, R: 2.98, hR: 1.02, belly: 2.1, nose: 'a350',
  wing: { span: 61.0, root: 12.4, tip: 2.0, sweep: 34, dihedral: 6, at: 0.385, pos: 'low', kink: 0.32, tipStyle: 'curved', wingletH: 3.3 },
  engines: [{ kind: 'fan', x: 10.0, dia: 3.45, len: 6.2, fwd: 3.5, drop: 1.8 }],
  fin: { h: 9.2, root: 9.6, tip: 3.3, sweep: 42, aft: 1.4 },
  stab: { span: 18.9, root: 5.8, tip: 1.9, sweep: 35, dihedral: 6, aft: 1.6 },
  gear: { mainX: 5.3, mainWheels: 4, tyre: 0.67, noseFromTip: 7.4, noseTyre: 0.52, mainDz: 1.0 },
  windows: { pitch: 0.635, w: 0.27, h: 0.42, y: 0.13, from: 8.2, to: 56.2 },
  doors: [{ z: 7.0 }, { z: 17.6 }, { z: 37.4 }, { z: 57.0 }, { z: 12.5, kind: 'cargo' }, { z: 47.0, kind: 'cargo' }],
};
const A35K = variant(A359, {
  L: 73.79,
  windows: { to: 62.6 },
  doors: [{ z: 7.0 }, { z: 19.0 }, { z: 41.0 }, { z: 63.4 }, { z: 12.5, kind: 'cargo' }, { z: 53.0, kind: 'cargo' }],
  gear: { mainWheels: 6, mainDz: 1.4 },
  wing: { root: 12.8 },
});
const A388: AirlinerSpec = {
  L: 72.72, R: 3.57, hR: 1.18, belly: 2.3, nose: 'a380', noseLen: 2.3, tailUp: 0.42,
  wing: { span: 79.75, root: 17.6, tip: 4.0, sweep: 35, dihedral: 5.6, at: 0.33, pos: 'low', kink: 0.32, tipStyle: 'fence', wingletH: 1.7 },
  engines: [
    { kind: 'fan', x: 15.1, dia: 3.4, len: 6.6, fwd: 3.6, drop: 1.85 },
    { kind: 'fan', x: 25.7, dia: 3.4, len: 6.6, fwd: 3.3, drop: 1.6 },
  ],
  fin: { h: 12.9, root: 13.0, tip: 4.4, sweep: 43, aft: 1.6 },
  stab: { span: 30.37, root: 9.0, tip: 2.6, sweep: 35, dihedral: 6, aft: 1.6 },
  gear: { mainX: 6.15, mainWheels: 4, tyre: 0.7, noseFromTip: 7.6, noseTyre: 0.6, mainDz: -0.4, body: { x: 2.1, wheels: 6, dz: -4.4 } },
  windows: { pitch: 0.533, w: 0.24, h: 0.36, y: -0.24, from: 8.6, to: 62.0, upper: { y: 0.5, from: 13.0, to: 60.0 } },
  doors: [{ z: 7.4 }, { z: 17.6 }, { z: 32.4 }, { z: 46.2 }, { z: 61.0 }, { z: 15.6, deck: 'upper' }, { z: 36.0, deck: 'upper' }, { z: 58.4, deck: 'upper' }],
};

// ── Regional jets ───────────────────────────────────────────────────────────

const E190: AirlinerSpec = {
  L: 36.24, R: 1.505, hR: 1.11, belly: 1.15, nose: 'ejet',
  wing: { span: 27.0, root: 5.6, tip: 1.3, sweep: 26, dihedral: 5, at: 0.39, pos: 'low', kink: 0.33, tipStyle: 'small', wingletH: 1.3 },
  engines: [{ kind: 'fan', x: 4.6, dia: 1.66, len: 3.6, fwd: 2.0, drop: 1.05 }],
  fin: { h: 6.0, root: 5.0, tip: 2.0, sweep: 38, aft: 0.7 },
  stab: { span: 12.08, root: 2.9, tip: 1.1, sweep: 32, dihedral: 6, aft: 0.8 },
  gear: { mainX: 2.97, mainWheels: 2, tyre: 0.52, noseFromTip: 3.6, noseTyre: 0.3, mainDz: 0.4 },
  windows: { pitch: 0.48, w: 0.24, h: 0.35, y: 0.16, from: 5.0, to: 30.4 },
  doors: [{ z: 3.9 }, { z: 16.4, kind: 'exit' }, { z: 31.2 }],
};
const E170 = variant(E190, { L: 31.68, wing: { span: 25.0, at: 0.4 }, windows: { to: 25.9 }, doors: [{ z: 3.9 }, { z: 14.2, kind: 'exit' }, { z: 26.7 }], engines: [{ kind: 'fan', x: 4.3, dia: 1.45, len: 3.3, fwd: 1.8, drop: 1.0 }] });
const E195 = variant(E190, { L: 38.65, windows: { to: 32.8 }, doors: [{ z: 3.9 }, { z: 17.6, kind: 'exit' }, { z: 33.6 }], wing: { at: 0.39 } });
const CRJ9: AirlinerSpec = {
  L: 36.4, R: 1.35, hR: 1.0, belly: 0.95, nose: 'crj', tailLen: 5.6,
  wing: { span: 24.85, root: 4.8, tip: 1.1, sweep: 28, dihedral: 4.5, at: 0.45, pos: 'low', kink: 0.33, tipStyle: 'small', wingletH: 1.1 },
  engines: [{ kind: 'rear', x: 2.65, dia: 1.35, len: 3.4, fwd: 27.4, drop: 0.55 }],
  fin: { h: 4.6, root: 4.4, tip: 2.6, sweep: 45, aft: 0.6 },
  stab: { span: 8.5, root: 2.3, tip: 1.1, sweep: 32, dihedral: -2, t: true },
  gear: { mainX: 2.0, mainWheels: 2, tyre: 0.48, noseFromTip: 3.0, noseTyre: 0.3, mainDz: 0.3 },
  windows: { pitch: 0.53, w: 0.24, h: 0.32, y: 0.12, from: 4.6, to: 27.0 },
  doors: [{ z: 3.6 }, { z: 15.6, kind: 'exit' }, { z: 26.8, kind: 'exit' }],
};
const CRJ7 = variant(CRJ9, { L: 32.51, wing: { span: 23.24 }, engines: [{ kind: 'rear', x: 2.6, dia: 1.3, len: 3.3, fwd: 23.8, drop: 0.55 }], windows: { to: 23.4 }, doors: [{ z: 3.6 }, { z: 13.8, kind: 'exit' }] });
const CRJ2 = variant(CRJ9, { L: 26.77, R: 1.35, wing: { span: 21.21, root: 4.3, tipStyle: 'small', wingletH: 0.9 }, engines: [{ kind: 'rear', x: 2.5, dia: 1.2, len: 3.2, fwd: 18.6, drop: 0.5 }], windows: { to: 18.2 }, doors: [{ z: 3.4 }, { z: 11.3, kind: 'exit' }], fin: { h: 4.1, root: 4.0, tip: 2.3 }, stab: { span: 6.4 } });
const E145: AirlinerSpec = variant(CRJ2, { L: 29.87, R: 1.14, belly: 0.85, nose: 'crj', wing: { span: 20.04, root: 4.0, tip: 1.1, sweep: 22, at: 0.46, tipStyle: 'small', wingletH: 0.7 }, engines: [{ kind: 'rear', x: 2.15, dia: 1.12, len: 3.0, fwd: 21.4, drop: 0.45 }], windows: { pitch: 0.5, w: 0.24, h: 0.3, from: 4.2, to: 21.0 }, doors: [{ z: 3.2 }, { z: 12.6, kind: 'exit' }], fin: { h: 3.8, root: 3.8, tip: 2.1, sweep: 42 }, stab: { span: 7.6 } });
const MD80: AirlinerSpec = {
  L: 45.06, R: 1.67, hR: 1.08, belly: 1.0, nose: 'dc9', tailLen: 5.2,
  wing: { span: 32.87, root: 6.6, tip: 1.6, sweep: 26, dihedral: 3, at: 0.43, pos: 'low', kink: 0.3, tipStyle: 'none' },
  engines: [{ kind: 'rear', x: 3.15, dia: 1.45, len: 5.6, fwd: 34.6, drop: 0.55 }],
  fin: { h: 5.4, root: 5.6, tip: 3.9, sweep: 47, aft: 0.6 },
  stab: { span: 12.2, root: 3.2, tip: 1.2, sweep: 34, dihedral: -2, t: true },
  gear: { mainX: 2.5, mainWheels: 2, tyre: 0.55, noseFromTip: 3.5, noseTyre: 0.33, mainDz: 0.3 },
  windows: { pitch: 0.508, w: 0.25, h: 0.33, y: 0.16, from: 5.8, to: 36.0 },
  doors: [{ z: 4.4 }, { z: 19.4, kind: 'exit' }, { z: 20.3, kind: 'exit' }],
};
const B712 = variant(MD80, { L: 37.81, wing: { span: 28.45, root: 6.0 }, engines: [{ kind: 'rear', x: 3.15, dia: 1.7, len: 4.6, fwd: 28.8, drop: 0.55 }], windows: { to: 29.0 }, doors: [{ z: 4.4 }, { z: 16.4, kind: 'exit' }] });

// ── Turboprops ──────────────────────────────────────────────────────────────

const AT76: AirlinerSpec = {
  L: 27.17, R: 1.43, hR: 1.0, belly: 0.95, nose: 'atr', tailLen: 6.2, tailUp: 0.5,
  wing: { span: 27.05, root: 2.6, tip: 1.4, sweep: 3, dihedral: 2, at: 0.43, pos: 'high', tipStyle: 'none' },
  engines: [{ kind: 'prop', x: 4.1, dia: 1.05, len: 4.8, fwd: 2.0, drop: 0.55, blades: 6, propDia: 3.93 }],
  fin: { h: 4.0, root: 3.4, tip: 1.9, sweep: 34, aft: 0.5 },
  stab: { span: 7.31, root: 1.7, tip: 1.0, sweep: 10, dihedral: 0, t: true },
  gear: { mainX: 2.05, mainWheels: 2, tyre: 0.42, noseFromTip: 2.0, noseTyre: 0.28, mainDz: 0.4, sponson: true },
  windows: { pitch: 0.76, w: 0.24, h: 0.35, y: 0.12, from: 4.8, to: 21.4 },
  doors: [{ z: 3.8, kind: 'cargo' }, { z: 22.4 }],
};
const AT45 = variant(AT76, { L: 22.67, wing: { span: 24.57, at: 0.43 }, windows: { to: 17.0 }, doors: [{ z: 3.8, kind: 'cargo' }, { z: 17.9 }] });
const DH8D: AirlinerSpec = {
  L: 32.83, R: 1.35, hR: 1.0, belly: 1.25, nose: 'q400', tailLen: 5.6, tailUp: 0.5,
  wing: { span: 28.42, root: 3.0, tip: 1.3, sweep: 3, dihedral: 2.5, at: 0.39, pos: 'high', tipStyle: 'none' },
  engines: [{ kind: 'prop', x: 4.1, dia: 1.1, len: 6.8, fwd: 2.2, drop: 0.55, blades: 6, propDia: 4.11 }],
  fin: { h: 4.6, root: 3.9, tip: 2.2, sweep: 33, aft: 0.5 },
  stab: { span: 8.8, root: 2.0, tip: 1.1, sweep: 12, dihedral: 0, t: true },
  gear: { mainX: 4.1, mainWheels: 2, tyre: 0.45, noseFromTip: 2.4, noseTyre: 0.3, inNacelle: true },
  windows: { pitch: 0.73, w: 0.24, h: 0.36, y: 0.12, from: 4.8, to: 26.6 },
  doors: [{ z: 3.8 }, { z: 27.6 }],
};
const PC12: AirlinerSpec = {
  L: 14.4, R: 0.78, hR: 1.05, belly: 0.75, nose: 'prop', tailLen: 6.6, tailUp: 0.55,
  wing: { span: 16.28, root: 2.4, tip: 1.2, sweep: 2, dihedral: 4, at: 0.36, pos: 'low', tipStyle: 'small', wingletH: 0.6 },
  engines: [],
  noseProp: { dia: 2.67, blades: 4 },
  fin: { h: 2.7, root: 2.2, tip: 1.2, sweep: 40, aft: 0.3 },
  stab: { span: 5.2, root: 1.2, tip: 0.7, sweep: 14, dihedral: 2, t: true },
  gear: { mainX: 2.3, mainWheels: 2, tyre: 0.3, noseFromTip: 1.5, noseTyre: 0.22 },
  windows: { pitch: 0.65, w: 0.3, h: 0.36, y: 0.2, from: 4.6, to: 8.6 },
  doors: [{ z: 3.9 }],
  greyBelly: false,
};
const BE20: AirlinerSpec = {
  L: 13.34, R: 0.74, hR: 1.08, belly: 0.75, nose: 'bizjet', tailLen: 6.0,
  wing: { span: 16.61, root: 2.3, tip: 1.0, sweep: 3, dihedral: 6, at: 0.33, pos: 'low', tipStyle: 'none' },
  engines: [{ kind: 'prop', x: 2.65, dia: 0.75, len: 3.4, fwd: 1.6, drop: 0.0, blades: 4, propDia: 2.5 }],
  fin: { h: 2.6, root: 2.2, tip: 1.1, sweep: 38, aft: 0.3 },
  stab: { span: 5.6, root: 1.2, tip: 0.7, sweep: 14, dihedral: 0, t: true },
  gear: { mainX: 2.65, mainWheels: 2, tyre: 0.3, noseFromTip: 1.9, noseTyre: 0.2 },
  windows: { pitch: 0.62, w: 0.3, h: 0.33, y: 0.18, from: 3.9, to: 7.8, oval: true },
  doors: [{ z: 8.6 }],
  greyBelly: false,
};

// ── Business jets ───────────────────────────────────────────────────────────

const BIZ_L: AirlinerSpec = {
  L: 15.6, R: 0.82, hR: 1.05, belly: 0.6, nose: 'bizjet', tailLen: 6.6,
  wing: { span: 15.9, root: 2.8, tip: 1.0, sweep: 18, dihedral: 4, at: 0.42, pos: 'low', tipStyle: 'small', wingletH: 0.7 },
  engines: [{ kind: 'rear', x: 1.45, dia: 0.85, len: 2.4, fwd: 10.6, drop: 0.38 }],
  fin: { h: 2.6, root: 2.4, tip: 1.4, sweep: 44, aft: 0.3 },
  stab: { span: 6.2, root: 1.3, tip: 0.65, sweep: 30, dihedral: 0, t: true },
  gear: { mainX: 1.9, mainWheels: 2, tyre: 0.28, noseFromTip: 1.8, noseTyre: 0.2 },
  windows: { pitch: 0.82, w: 0.34, h: 0.4, y: 0.16, from: 3.6, to: 7.8, oval: true },
  doors: [{ z: 2.6 }],
  greyBelly: false,
};
const BIZ_M = variant(BIZ_L, { L: 20.92, R: 1.1, belly: 0.75, wing: { span: 21.0, root: 3.6, tip: 1.2, sweep: 27, tipStyle: 'small', wingletH: 1.0 }, engines: [{ kind: 'rear', x: 1.9, dia: 1.2, len: 3.0, fwd: 14.6, drop: 0.45 }], fin: { h: 3.4, root: 3.2, tip: 1.8 }, stab: { span: 7.8, root: 1.6, tip: 0.8 }, gear: { mainX: 1.95, tyre: 0.33, noseFromTip: 2.4 }, windows: { pitch: 0.9, w: 0.36, h: 0.44, from: 4.0, to: 11.5 }, doors: [{ z: 2.9 }] });
const BIZ_H = variant(BIZ_L, { L: 30.41, R: 1.3, belly: 0.95, wing: { span: 30.36, root: 5.4, tip: 1.6, sweep: 33, tipStyle: 'blended', wingletH: 1.6 }, engines: [{ kind: 'rear', x: 2.55, dia: 1.55, len: 4.2, fwd: 21.5, drop: 0.55 }], fin: { h: 4.6, root: 4.4, tip: 2.6 }, stab: { span: 10.5, root: 2.3, tip: 1.1 }, gear: { mainX: 2.3, tyre: 0.45, noseFromTip: 3.3 }, windows: { pitch: 1.05, w: 0.42, h: 0.6, from: 5.2, to: 17.5 }, doors: [{ z: 3.6 }] });

// ── Catalogue ───────────────────────────────────────────────────────────────

export const MODELS: ModelDef[] = [
  jet('a319', 'Airbus A319', 'narrowbody', ['A318', 'A319'], A319),
  jet('a19n', 'Airbus A319neo', 'narrowbody', ['A19N'], A19N),
  jet('a320', 'Airbus A320', 'narrowbody', ['A320'], A320),
  jet('a20n', 'Airbus A320neo', 'narrowbody', ['A20N', 'C919'], A20N),
  jet('a321', 'Airbus A321', 'narrowbody', ['A321'], A321),
  jet('a21n', 'Airbus A321neo', 'narrowbody', ['A21N'], A21N),
  jet('bcs1', 'Airbus A220-100', 'narrowbody', ['BCS1', 'A221', 'SU95'], BCS1),
  jet('bcs3', 'Airbus A220-300', 'narrowbody', ['BCS3', 'A223'], BCS3),
  jet('b737', 'Boeing 737-700', 'narrowbody', ['B731', 'B732', 'B733', 'B734', 'B735', 'B736', 'B737'], B737),
  jet('b738', 'Boeing 737-800', 'narrowbody', ['B738'], B738),
  jet('b739', 'Boeing 737-900', 'narrowbody', ['B739'], B739),
  jet('b37m', 'Boeing 737 MAX 7', 'narrowbody', ['B37M'], B37M),
  jet('b38m', 'Boeing 737 MAX 8', 'narrowbody', ['B38M'], B38M),
  jet('b39m', 'Boeing 737 MAX 9/10', 'narrowbody', ['B39M', 'B3XM'], B39M),
  jet('b752', 'Boeing 757-200', 'narrowbody', ['B752', 'B753'], B752),
  jet('b763', 'Boeing 767-300', 'widebody', ['B762', 'B763', 'B764'], B763),
  jet('b772', 'Boeing 777-200', 'widebody', ['B772', 'MD11', 'DC10'], B772),
  jet('b77l', 'Boeing 777-200LR / 777F', 'widebody', ['B77L'], B77L),
  jet('b77w', 'Boeing 777-300ER', 'widebody', ['B773', 'B77W'], B77W),
  jet('b779', 'Boeing 777-9', 'widebody', ['B778', 'B779'], B779),
  jet('b788', 'Boeing 787-8', 'widebody', ['B788'], B788),
  jet('b789', 'Boeing 787-9', 'widebody', ['B789'], B789),
  jet('b78x', 'Boeing 787-10', 'widebody', ['B78X'], B78X),
  jet('b744', 'Boeing 747-400', 'widebody', ['B741', 'B742', 'B743', 'B744', 'B74S', 'BLCF'], B744),
  jet('b748', 'Boeing 747-8', 'widebody', ['B748'], B748),
  jet('a332', 'Airbus A330-200', 'widebody', ['A332', 'A306', 'A30B', 'A310'], A332),
  jet('a333', 'Airbus A330-300', 'widebody', ['A333', 'A337'], A333),
  jet('a339', 'Airbus A330-900neo', 'widebody', ['A338', 'A339'], A339),
  jet('a343', 'Airbus A340-300', 'widebody', ['A342', 'A343'], A343),
  jet('a346', 'Airbus A340-600', 'widebody', ['A345', 'A346'], A346),
  jet('a359', 'Airbus A350-900', 'widebody', ['A359'], A359),
  jet('a35k', 'Airbus A350-1000', 'widebody', ['A35K'], A35K),
  jet('a388', 'Airbus A380-800', 'widebody', ['A388'], A388),
  jet('e170', 'Embraer E175', 'regional', ['E170', 'E175', 'E75L', 'E75S'], E170),
  jet('e190', 'Embraer E190', 'regional', ['E190', 'E290'], E190),
  jet('e195', 'Embraer E195', 'regional', ['E195', 'E295'], E195),
  jet('crj2', 'Bombardier CRJ200', 'regional', ['CRJ1', 'CRJ2'], CRJ2),
  jet('crj7', 'Bombardier CRJ700', 'regional', ['CRJ7'], CRJ7),
  jet('crj9', 'Bombardier CRJ900/1000', 'regional', ['CRJ9', 'CRJX', 'ARJ21'], CRJ9),
  jet('e145', 'Embraer ERJ-145', 'regional', ['E135', 'E145'], E145),
  jet('md80', 'McDonnell Douglas MD-80', 'narrowbody', ['MD80', 'MD81', 'MD82', 'MD83', 'MD87', 'MD88', 'MD90'], MD80),
  jet('b712', 'Boeing 717', 'narrowbody', ['B712'], B712),
  jet('at76', 'ATR 72', 'turboprop', ['AT72', 'AT73', 'AT75', 'AT76', 'C130', 'C30J', 'C295', 'MA60'], AT76),
  jet('at45', 'ATR 42', 'turboprop', ['AT43', 'AT44', 'AT45', 'AT46', 'F50', 'F27', 'CN35', 'D328', 'SF34', 'C212', 'JS41'], AT45),
  jet('dh8d', 'De Havilland Dash 8-400', 'turboprop', ['DH8D', 'Q400', 'DH8A', 'DH8B', 'DH8C'], DH8D),
  jet('pc12', 'Pilatus PC-12', 'turboprop', ['PC12', 'C208', 'TBM7', 'TBM8', 'TBM9', 'KODI', 'PC6T'], PC12),
  jet('be20', 'Beechcraft King Air', 'turboprop', ['BE20', 'BE30', 'BE9L', 'BE35', 'B190', 'D228', 'L410', 'JS31', 'JS32', 'P180', 'DHC6', 'Y12', 'SW4', 'SB20'], BE20),
  jet('bizl', 'Light business jet', 'bizjet', ['C25A', 'C25B', 'C25C', 'C25M', 'C510', 'C525', 'C550', 'E50P', 'E55P', 'E545', 'E550', 'LJ35', 'LJ40', 'LJ45', 'LJ55', 'PRM1', 'HDJT', 'SF50', 'EA50', 'BE40', 'PC24', 'H25B', 'H25C'], BIZ_L, [1024, 256]),
  jet('bizm', 'Mid-size business jet', 'bizjet', ['C560', 'C56X', 'C650', 'C680', 'C68A', 'C700', 'C750', 'CL30', 'CL35', 'G150', 'G200', 'G280', 'LJ60', 'LJ75', 'FA10', 'FA20', 'FA50', 'F2TH'], BIZ_M, [1024, 256]),
  jet('bizh', 'Large business jet', 'bizjet', ['CL60', 'GL5T', 'GL7T', 'GLEX', 'GLF4', 'GLF5', 'GLF6', 'GA5C', 'GA6C', 'GA7C', 'GA8C', 'FA7X', 'FA8X', 'FA6X', 'F900'], BIZ_H, [2048, 256]),
  { id: 'heli', name: 'Helicopter', cls: 'helicopter', types: [], livery: true, gear: false, build: buildHelicopter },
  { id: 'c172', name: 'High-wing single', cls: 'light', types: ['C150', 'C152', 'C162', 'C170', 'C172', 'C177', 'C182', 'C206', 'C210', 'P210'], livery: true, gear: false, build: () => buildLight(true) },
  { id: 'pa28', name: 'Low-wing single', cls: 'light', types: ['P28A', 'P28B', 'P28R', 'PA31', 'PA34', 'PA44', 'PA46', 'SR20', 'SR22', 'DA40', 'DA42', 'DA62', 'TB20', 'M20P', 'BE36', 'BE58', 'G115', 'PIVI', 'CRUZ'], livery: true, gear: false, build: () => buildLight(false) },
];

/** Model used when only the class (or nothing) is known. */
export const CLASS_DEFAULT: Record<ModelClass, string> = {
  narrowbody: 'a20n',
  widebody: 'b77w',
  regional: 'e190',
  turboprop: 'at76',
  bizjet: 'bizm',
  helicopter: 'heli',
  light: 'c172',
  generic: 'a320',
};
