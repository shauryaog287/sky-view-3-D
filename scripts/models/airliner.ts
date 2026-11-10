/**
 * Parametric airliner / regional / turboprop / bizjet builder. Every model is generated from public dimensions of
 * one aircraft type (length, span, fuselage width, engine size and position, tail size, gear track), so a 777-300ER
 * looks like a 777-300ER next to an A320neo — not a scaled "widebody" blob.
 *
 * Coordinates: glTF +Y up, +Z forward (nose), +X left wing; origin on the ground below the middle of the fuselage.
 */
import { Builder, hex, type MaterialDef, type RGB, type Station, type V3 } from './core';
import { inPoly, inRounded, paintLathe, profileAt, type Layer } from './paint';
import type { Texture } from './core';

export type NoseStyle = 'airbus' | 'a350' | 'a380' | 'a220' | 'b737' | 'b757' | 'b767' | 'b777' | 'b787' | 'b747' | 'ejet' | 'crj' | 'dc9' | 'atr' | 'q400' | 'bizjet' | 'prop';
export type TipStyle = 'none' | 'fence' | 'sharklet' | 'blended' | 'split' | 'raked' | 'canted' | 'curved' | 'small';

export interface EngineSpec {
  kind: 'fan' | 'prop' | 'rear';
  /** Lateral position of the engine centre, m. */
  x: number;
  /** Nacelle maximum diameter and length, m. */
  dia: number;
  len: number;
  /** fan/prop: inlet ahead of the local wing leading edge (m). rear: inlet distance from the nose tip (m). */
  fwd: number;
  /** fan/prop: nacelle centre below the wing chord plane (m). rear: centre above the fuselage centre line (m). */
  drop: number;
  blades?: number;
  propDia?: number;
}

export interface AirlinerSpec {
  L: number;
  /** Fuselage half-width and height/width ratio. */
  R: number;
  hR?: number;
  /** Fuselage bottom above the ground (gear down), m. */
  belly: number;
  nose: NoseStyle;
  /** Nose and tail-cone lengths in fuselage radii (defaults per style). */
  noseLen?: number;
  tailLen?: number;
  /** Height of the tail tip above the centre line (× vertical radius). */
  tailUp?: number;
  wing: {
    span: number;
    /** Chord at the centre line and at the tip, m. */
    root: number;
    tip: number;
    /** Leading-edge sweep and dihedral, degrees. */
    sweep: number;
    dihedral: number;
    /** Root leading edge, fraction of L from the nose. */
    at: number;
    pos: 'low' | 'high';
    /** Trailing-edge kink as a fraction of the semi-span (0 = straight taper). */
    kink?: number;
    tipStyle: TipStyle;
    wingletH?: number;
  };
  engines: EngineSpec[];
  fin: { h: number; root: number; tip: number; sweep: number; aft?: number };
  stab: { span: number; root: number; tip: number; sweep: number; dihedral: number; t?: boolean; y?: number; aft?: number };
  gear: {
    mainX: number;
    mainWheels: 2 | 4 | 6;
    tyre: number;
    noseFromTip: number;
    noseTyre: number;
    mainDz?: number;
    body?: { x: number; wheels: 4 | 6; dz: number };
    sponson?: boolean;
    inNacelle?: boolean;
  };
  windows: {
    pitch: number;
    w: number;
    h: number;
    /** Centre height above the fuselage centre line (× vertical radius). */
    y: number;
    /** Range along the cabin, m from the nose tip. */
    from: number;
    to: number;
    oval?: boolean;
    upper?: { y: number; from: number; to: number };
  };
  doors: { z: number; kind?: 'main' | 'exit' | 'cargo'; deck?: 'upper' }[];
  /** 747 upper deck: the crown is raised by h metres from the nose to `to` metres from the nose tip. */
  hump?: { to: number; h: number };
  noseProp?: { dia: number; blades: number };
  /** Lighter grey belly (most liveries); false keeps the whole fuselage white. */
  greyBelly?: boolean;
}

// ── Materials ───────────────────────────────────────────────────────────────

/** sRGB hex → linear RGBA factor (glTF factors are linear). */
function lin(c: string, a = 1): [number, number, number, number] {
  const [r, g, b] = hex(c).map((v) => (v / 255) ** 2.2);
  return [r, g, b, a];
}

export const MATERIALS: Record<string, MaterialDef> = {
  fuselage: { color: [1, 1, 1, 1], metallic: 0.05, roughness: 0.36, texture: 'fus' },
  wing: { color: lin('#c4c9cf'), metallic: 0.3, roughness: 0.42 },
  stab: { color: lin('#d6dade'), metallic: 0.2, roughness: 0.4 },
  livery: { color: lin('#f1f2f4'), metallic: 0.05, roughness: 0.34 },
  nacelle: { color: lin('#eceef1'), metallic: 0.15, roughness: 0.3 },
  lip: { color: lin('#c9ced4'), metallic: 0.85, roughness: 0.22 },
  pylon: { color: lin('#d2d6db'), metallic: 0.25, roughness: 0.4 },
  inlet: { color: lin('#7d838b'), metallic: 0.6, roughness: 0.35 },
  fan: { color: lin('#101215'), metallic: 0.5, roughness: 0.45, doubleSided: true },
  spinner: { color: lin('#aab0b7'), metallic: 0.85, roughness: 0.22 },
  core: { color: lin('#8f959c'), metallic: 0.6, roughness: 0.35 },
  exhaust: { color: lin('#5d5650'), metallic: 0.6, roughness: 0.5 },
  fairing: { color: lin('#d5d9de'), metallic: 0.1, roughness: 0.4 },
  tire: { color: lin('#1b1c1e'), metallic: 0, roughness: 0.92 },
  hub: { color: lin('#a3a9b0'), metallic: 0.65, roughness: 0.35 },
  strut: { color: lin('#c6cad0'), metallic: 0.7, roughness: 0.3 },
  blade: { color: lin('#26282c'), metallic: 0.2, roughness: 0.6, doubleSided: true },
  blur: { color: lin('#3a3e44', 0.2), metallic: 0, roughness: 0.8, doubleSided: true, blend: true },
  glass: { color: lin('#18202a'), metallic: 0.6, roughness: 0.08 },
  navRed: { color: lin('#ff2a2a'), metallic: 0, roughness: 0.5, emissive: [1, 0.08, 0.08] },
  navGreen: { color: lin('#22ff55'), metallic: 0, roughness: 0.5, emissive: [0.06, 1, 0.2] },
  navWhite: { color: lin('#ffffff'), metallic: 0, roughness: 0.5, emissive: [1, 1, 1] },
};

// Texture colours (sRGB).
const C = {
  white: hex('#f3f4f6'),
  belly: hex('#d5d9de'),
  window: hex('#1f2a36'),
  glass: hex('#141b23'),
  frame: hex('#e9ebee'),
  seam: hex('#a9b0b8'),
  mask: hex('#15181c'),
  apu: hex('#3b3f45'),
};

// ── Nose styles ─────────────────────────────────────────────────────────────

interface NoseDef {
  /** Nose length (× R), tip height (× Rv) and superellipse exponents for the top, bottom and side outlines. */
  len: number;
  tipY: number;
  pt: number;
  pb: number;
  pw: number;
  /**
   * Cockpit windscreen in side view: d = distance from the nose tip (× R), y = height above the centre line (× Rv).
   * Bottom edge (d0,yb0)→(d1,yb1); top edge (d0+fs,yt0)→(d1−rs,yt1); posts at d values; side post where |x|/halfwidth = sp.
   */
  ws: { d0: number; d1: number; yb0: number; yb1: number; yt0: number; yt1: number; fs: number; rs: number; posts: number[]; sp: number; mask?: number };
}

const NOSES: Record<NoseStyle, NoseDef> = {
  airbus: { len: 2.6, tipY: -0.3, pt: 1.55, pb: 2.4, pw: 1.9, ws: { d0: 0.92, d1: 2.05, yb0: 0.21, yb1: 0.33, yt0: 0.5, yt1: 0.6, fs: 0.22, rs: 0.12, posts: [1.42, 1.76], sp: 0.55 } },
  a350: { len: 2.6, tipY: -0.28, pt: 1.55, pb: 2.4, pw: 1.9, ws: { d0: 0.92, d1: 2.0, yb0: 0.20, yb1: 0.32, yt0: 0.5, yt1: 0.6, fs: 0.22, rs: 0.14, posts: [1.5], sp: 0.55, mask: 0.1 } },
  a380: { len: 2.35, tipY: -0.36, pt: 1.75, pb: 2.5, pw: 2.0, ws: { d0: 0.76, d1: 1.76, yb0: 0.06, yb1: 0.09, yt0: 0.27, yt1: 0.33, fs: 0.16, rs: 0.1, posts: [1.2, 1.48], sp: 0.55 } },
  a220: { len: 2.7, tipY: -0.32, pt: 1.55, pb: 2.3, pw: 1.9, ws: { d0: 0.95, d1: 2.1, yb0: 0.20, yb1: 0.33, yt0: 0.52, yt1: 0.62, fs: 0.22, rs: 0.16, posts: [1.52], sp: 0.55 } },
  b737: { len: 2.8, tipY: -0.38, pt: 1.45, pb: 2.2, pw: 1.8, ws: { d0: 0.98, d1: 2.15, yb0: 0.16, yb1: 0.36, yt0: 0.5, yt1: 0.62, fs: 0.2, rs: 0.28, posts: [1.42, 1.8], sp: 0.52 } },
  b757: { len: 3.0, tipY: -0.4, pt: 1.4, pb: 2.2, pw: 1.8, ws: { d0: 1.05, d1: 2.25, yb0: 0.19, yb1: 0.38, yt0: 0.54, yt1: 0.64, fs: 0.2, rs: 0.28, posts: [1.5, 1.88], sp: 0.52 } },
  b767: { len: 2.6, tipY: -0.32, pt: 1.55, pb: 2.3, pw: 1.9, ws: { d0: 0.92, d1: 1.98, yb0: 0.21, yb1: 0.36, yt0: 0.52, yt1: 0.6, fs: 0.18, rs: 0.22, posts: [1.32, 1.66], sp: 0.53 } },
  b777: { len: 2.45, tipY: -0.28, pt: 1.65, pb: 2.4, pw: 2.0, ws: { d0: 0.85, d1: 1.86, yb0: 0.21, yb1: 0.34, yt0: 0.52, yt1: 0.6, fs: 0.17, rs: 0.2, posts: [1.24, 1.56], sp: 0.54 } },
  b787: { len: 2.7, tipY: -0.3, pt: 1.5, pb: 2.3, pw: 1.85, ws: { d0: 0.95, d1: 2.05, yb0: 0.15, yb1: 0.42, yt0: 0.5, yt1: 0.62, fs: 0.18, rs: 0.38, posts: [1.42], sp: 0.54 } },
  b747: { len: 2.9, tipY: -0.3, pt: 1.6, pb: 2.5, pw: 2.0, ws: { d0: 1.45, d1: 2.4, yb0: 1.12, yb1: 1.18, yt0: 1.32, yt1: 1.4, fs: 0.12, rs: 0.1, posts: [1.82, 2.1], sp: 0.5 } },
  ejet: { len: 2.7, tipY: -0.34, pt: 1.5, pb: 2.2, pw: 1.8, ws: { d0: 0.95, d1: 2.1, yb0: 0.19, yb1: 0.34, yt0: 0.52, yt1: 0.62, fs: 0.2, rs: 0.22, posts: [1.4, 1.76], sp: 0.52 } },
  crj: { len: 3.1, tipY: -0.32, pt: 1.4, pb: 2.1, pw: 1.7, ws: { d0: 1.05, d1: 2.2, yb0: 0.21, yb1: 0.36, yt0: 0.58, yt1: 0.66, fs: 0.2, rs: 0.22, posts: [1.62], sp: 0.52 } },
  dc9: { len: 3.1, tipY: -0.34, pt: 1.4, pb: 2.1, pw: 1.7, ws: { d0: 1.05, d1: 2.25, yb0: 0.17, yb1: 0.36, yt0: 0.52, yt1: 0.64, fs: 0.2, rs: 0.28, posts: [1.5, 1.88], sp: 0.52 } },
  atr: { len: 2.5, tipY: -0.22, pt: 1.6, pb: 2.4, pw: 1.9, ws: { d0: 0.85, d1: 2.0, yb0: 0.13, yb1: 0.26, yt0: 0.56, yt1: 0.62, fs: 0.24, rs: 0.16, posts: [1.42], sp: 0.54 } },
  q400: { len: 3.0, tipY: -0.3, pt: 1.45, pb: 2.2, pw: 1.8, ws: { d0: 1.0, d1: 2.2, yb0: 0.19, yb1: 0.33, yt0: 0.56, yt1: 0.64, fs: 0.22, rs: 0.2, posts: [1.6], sp: 0.52 } },
  bizjet: { len: 3.4, tipY: -0.3, pt: 1.4, pb: 2.1, pw: 1.7, ws: { d0: 1.15, d1: 2.45, yb0: 0.19, yb1: 0.34, yt0: 0.62, yt1: 0.7, fs: 0.24, rs: 0.3, posts: [1.78], sp: 0.52 } },
  prop: { len: 2.6, tipY: 0.0, pt: 2.6, pb: 2.6, pw: 2.6, ws: { d0: 2.6, d1: 4.3, yb0: 0.36, yb1: 0.38, yt0: 1.2, yt1: 1.2, fs: 0.9, rs: 0.3, posts: [], sp: 0.5 } },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const D2R = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number, p: number) => 1 - (1 - t) ** p;
const sup = (u: number, p: number) => (u <= 0 ? 0 : u >= 1 ? 1 : (1 - (1 - u) ** p) ** (1 / p));
const mirror = (v: V3): V3 => [-v[0], v[1], v[2]];

const AIRFOIL_X = [1, 0.85, 0.66, 0.47, 0.3, 0.17, 0.08, 0.03, 0.007, 0, 0.007, 0.03, 0.08, 0.17, 0.3, 0.47, 0.66, 0.85, 1];
const naca = (x: number) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

/** Airfoil section with its leading edge at `le`, chord along −Z, thickness along `thick` (unit vector). */
function airfoil(le: V3, chord: number, t: number, thick: V3, lowerScale = 0.75): V3[] {
  const mid = (AIRFOIL_X.length - 1) / 2;
  return AIRFOIL_X.map((xc, i) => {
    const s = i < mid ? 1 : i > mid ? -lowerScale : 0;
    const yt = naca(xc) * t * chord * s;
    return [le[0] + thick[0] * yt, le[1] + thick[1] * yt, le[2] - xc * chord + thick[2] * yt];
  });
}

export interface ModelLights {
  /** Left wingtip (mirrored for the right): strobes and navigation lights. */
  tip: [number, number, number];
  tail: [number, number, number];
  /** Red beacons on top of and under the fuselage. */
  top: [number, number, number];
  belly: [number, number, number];
  /** Left landing light at the wing root (mirrored for the right). */
  land: [number, number, number];
}

/**
 * Paint zones in the `_LIVERY` vertex attribute, read by the app's livery shader: fin and winglets take the tail
 * colour, nacelles the engine colour, and the fuselage gets belly / cheatline / rear-sweep colours by position.
 */
export const ZONE = { TAIL: 1, ENGINE: 0.5, FUSELAGE: 0.25 } as const;

export interface Built {
  b: Builder;
  textures: Record<string, Texture>;
  /** Where the aircraft's lights are, in the app's model frame: [forward, left, up] metres from the origin. */
  lights?: ModelLights;
  /** Overall dimensions for the manifest. */
  length: number;
  span: number;
  height: number;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildAirliner(s: AirlinerSpec, texW = 2048, texH = 512): Built {
  const b = new Builder();
  const L = s.L;
  const R = s.R;
  const Rv = R * (s.hR ?? 1.04);
  const yc = s.belly + Rv;
  const z0 = -L / 2;
  const z1 = L / 2;
  const nose = NOSES[s.nose];
  const Ln = (s.noseLen ?? nose.len) * R;
  const Lt = (s.tailLen ?? 4.8) * R;
  const tailUp = s.tailUp ?? 0.55;
  const segs = R > 2.4 ? 48 : R > 1.2 ? 40 : 28;

  // Fuselage profile → lathe stations.
  const st = (z: number, top: number, bot: number, hw: number): Station => {
    const r = Math.max((top - bot) / 2, 0);
    return [z, r, yc + (top + bot) / 2, r > 1e-4 ? hw / r : 1];
  };
  const tipR = 0.09 * R;
  const stations: Station[] = [];
  for (const t of [0, 0.03, 0.08, 0.15, 0.24, 0.35, 0.48, 0.62, 0.76, 0.9, 1]) {
    stations.push(st(z0 + t * Lt, lerp(tailUp * Rv + tipR, Rv, ease(t, 2.2)), lerp(tailUp * Rv - tipR, -Rv, ease(t, 1.45)), lerp(tipR, R, ease(t, 1.8))));
  }
  const tipY = nose.tipY * Rv;
  // 747 upper deck: the crown rises by hump.h over the forward fuselage and fairs back down over `fair` metres.
  const hp = s.hump;
  const fair = hp ? Math.min(9, hp.to * 0.32) : 0;
  const humpAt = (dn: number) => {
    if (!hp || dn >= hp.to) return 0;
    if (dn <= hp.to - fair) return hp.h;
    const t = (hp.to - dn) / fair;
    return hp.h * t * t * (3 - 2 * t);
  };
  if (hp) {
    for (const k of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const dn = hp.to - fair * k;
      if (dn > Ln + 0.5) stations.push(st(z1 - dn, Rv + humpAt(dn), -Rv, R));
    }
  }
  for (const u of [1, 0.86, 0.72, 0.6, 0.49, 0.39, 0.3, 0.22, 0.155, 0.1, 0.06, 0.032, 0.014, 0.004, 0]) {
    const top = Rv + humpAt(u * Ln);
    stations.push(st(z1 - u * Ln, tipY + (top - tipY) * sup(u, nose.pt), tipY - (Rv + tipY) * sup(u, nose.pb), R * sup(u, nose.pw)));
  }
  const topAt = (z: number) => {
    const p = profileAt(stations, z);
    return p.yc + p.r;
  };
  const botAt = (z: number) => {
    const p = profileAt(stations, z);
    return p.yc - p.r;
  };
  const hwAt = (z: number) => profileAt(stations, z).hw;
  b.lathe('fuselage', stations, segs, [0, 0, 0], { uZ0: z0, uZ1: z1, livery: ZONE.FUSELAGE });

  // ── Texture ──
  const winY = yc + s.windows.y * Rv;
  const layers: Layer[] = [];
  layers.push(windscreenLayer(nose, z1, yc, R, Rv));
  layers.push(...doorLayers(s, z1, yc, Rv, winY));
  layers.push(windowLayer(s.windows, z1, winY, s.doors.filter((d) => d.deck !== 'upper'), s.windows.oval));
  if (s.windows.upper) {
    const u = s.windows.upper;
    layers.push(windowLayer({ ...s.windows, from: u.from, to: u.to }, z1, yc + u.y * Rv, s.doors.filter((d) => d.deck === 'upper'), s.windows.oval));
  }
  layers.push((p) => (p.z < z0 + 0.06 * R ? C.apu : undefined));
  if (s.greyBelly !== false) layers.push((p) => (p.y - p.yc < -0.46 * p.r ? C.belly : undefined));
  const textures: Record<string, Texture> = { fus: paintLathe(texW, texH, stations, z0, z1, layers, C.white) };

  // ── Wing ──
  const w = s.wing;
  const semi = w.span / 2;
  const tanS = Math.tan(w.sweep * D2R);
  const tanD = Math.tan(w.dihedral * D2R);
  const zLEroot = z1 - w.at * L;
  const yRoot = w.pos === 'low' ? yc - 0.56 * Rv : yc + 0.84 * Rv;
  const kinkX = (w.kink ?? 0) * semi;
  const raked = w.tipStyle === 'raked';
  const mainTipX = raked ? semi * 0.9 : semi;
  const kinkChord = kinkX > 0 ? Math.max(w.root - tanS * kinkX, w.tip * 1.2) : w.root;
  const chordAt = (x: number) => {
    if (kinkX > 0 && x <= kinkX) return lerp(w.root, kinkChord, x / kinkX);
    const x0 = kinkX > 0 ? kinkX : 0;
    const c0 = kinkX > 0 ? kinkChord : w.root;
    return lerp(c0, w.tip, Math.min(1, (x - x0) / (mainTipX - x0)));
  };
  const leAt = (x: number) => zLEroot - tanS * Math.min(x, mainTipX) - (x > mainTipX ? Math.tan((w.sweep + 22) * D2R) * (x - mainTipX) : 0);
  const wyAt = (x: number) => yRoot + tanD * x;
  const tcAt = (x: number) => lerp(0.145, 0.095, Math.min(1, x / semi));
  const wingX = [0, R * 0.9, ...(kinkX > R ? [kinkX] : []), mainTipX, ...(raked ? [semi] : [])];
  const wingSections = wingX.map((x) => {
    const c = x > mainTipX ? w.tip * 0.28 : chordAt(x);
    // Raked tip: trailing edge sweeps forward to meet the extended leading edge.
    return airfoil([x, wyAt(x), leAt(x)], c, tcAt(x), [0, 1, 0], 0.7);
  });
  b.loft('wing', wingSections);
  b.loft('wing', wingSections.map((sec) => sec.map(mirror)));
  const tip = { x: semi, y: wyAt(semi), z: leAt(semi), c: raked ? w.tip * 0.28 : w.tip };
  winglet(b, w.tipStyle, tip, w.wingletH ?? 0);

  // Wing-to-body fairing (low wing) or wing root fairing on top (high wing).
  if (w.pos === 'low') {
    const fz1 = zLEroot + 0.3 * w.root;
    const fz0 = zLEroot - w.root * 1.28;
    const rf = 0.52 * Rv;
    const fy = yc - 0.56 * Rv;
    const fst: Station[] = [0, 0.06, 0.18, 0.35, 0.55, 0.75, 0.9, 1].map((t) => {
      const shape = t < 0.45 ? sup(t / 0.45, 1.9) : sup((1 - t) / 0.55, 2.4);
      return [lerp(fz0, fz1, t), Math.max(0.02, rf * shape), fy, (R * 0.93) / rf];
    });
    b.lathe('fairing', fst, 28);
  } else {
    const fz1 = zLEroot + 0.25 * w.root;
    const fz0 = zLEroot - w.root * 1.35;
    const rf = 0.32 * Rv;
    const fy = yc + 0.78 * Rv;
    const fst: Station[] = [0, 0.1, 0.3, 0.6, 0.85, 1].map((t) => {
      const shape = t < 0.3 ? sup(t / 0.3, 2) : sup((1 - t) / 0.7, 1.6);
      return [lerp(fz0, fz1, t), Math.max(0.02, rf * shape), fy, (R * 0.55) / rf];
    });
    b.lathe('fairing', fst, 20);
  }

  // ── Engines ──
  for (const e of s.engines) {
    for (const side of [1, -1]) {
      if (e.kind === 'rear') {
        const cx = side * e.x;
        const cy = yc + e.drop;
        const zf = z1 - e.fwd;
        fan(b, cx, cy, zf, e.dia / 2, e.len);
        // Horizontal pylon from the fuselage side to the nacelle.
        const pz = zf - e.len * 0.3;
        const chord = e.len * 0.45;
        const inner = hwAt(pz - chord / 2) * 0.85;
        const outer = e.x - e.dia * 0.3;
        const secs = [inner, outer].map((x) => airfoil([side * x, cy, pz], chord, 0.32 / chord, [0, 1, 0], 1));
        b.loft('pylon', secs);
        continue;
      }
      const cx = side * e.x;
      const wy = wyAt(e.x);
      const wle = leAt(e.x);
      const zf = wle + e.fwd;
      const cy = wy - e.drop;
      const Rn = e.dia / 2;
      if (e.kind === 'fan') {
        fan(b, cx, cy, zf, Rn, e.len);
        const cLocal = chordAt(e.x);
        const bottom = airfoil([cx, cy + Rn * 0.8, zf - e.len * 0.16], e.len * 0.8, (0.34 * Rn) / (e.len * 0.8), [1, 0, 0], 1);
        const top = airfoil([cx, wy + 0.05, wle + 0.12], cLocal * 0.62, (0.3 * Rn) / (cLocal * 0.62), [1, 0, 0], 1);
        b.loft('pylon', [bottom, top]);
      } else {
        prop(b, cx, cy, zf, Rn, e.len, e.propDia ?? 3.9, e.blades ?? 6, wy, side);
        if (s.gear.inNacelle) {
          // Main gear hangs under the long nacelle (Dash 8).
          b.inGroup('gear', () => gearLeg(b, cx, cy - Rn * 0.7, wle - chordAt(e.x) * 0.55, s.gear.tyre, 2));
        }
      }
    }
  }
  if (s.noseProp) {
    const np = s.noseProp;
    const zf = z1;
    spinnerAndProp(b, 0, yc + tipY, zf, R * 0.4, np.dia, np.blades);
  }

  // ── Tail ──
  const f = s.fin;
  const finTE = z0 + (f.aft ?? 0.35 * R);
  const finLE = finTE + f.root;
  const finY = topAt(finTE + f.root * 0.25) - 0.12 * R;
  const finTanS = Math.tan(f.sweep * D2R);
  const fillet = f.root * 0.32;
  const finSecs = [
    airfoil([0, finY - 0.05, finLE + fillet], f.root + fillet, 0.1, [1, 0, 0], 1),
    airfoil([0, finY + f.h * 0.14, finLE - finTanS * f.h * 0.14], lerp(f.root, f.tip, 0.14), 0.11, [1, 0, 0], 1),
    airfoil([0, finY + f.h, finLE - finTanS * f.h], f.tip, 0.1, [1, 0, 0], 1),
  ];
  b.loft('livery', finSecs, { livery: 1 });
  const finTop = finY + f.h;

  const sb = s.stab;
  const stabTanS = Math.tan(sb.sweep * D2R);
  const stabTanD = Math.tan(sb.dihedral * D2R);
  let sy: number;
  let sLE: number;
  if (sb.t) {
    sy = finTop - 0.05;
    sLE = finLE - finTanS * f.h + 0.25 * f.tip;
  } else {
    sy = yc + (sb.y ?? 0.22) * Rv;
    sLE = z0 + (sb.aft ?? 0.5 * R) + sb.root;
  }
  const stabSecs = [0, sb.span / 2].map((x) => airfoil([x, sy + stabTanD * x, sLE - stabTanS * x], x === 0 ? sb.root : sb.tip, 0.1, [0, 1, 0], 1));
  b.loft('stab', stabSecs);
  b.loft('stab', stabSecs.map((sec) => sec.map(mirror)));

  // ── Gear (separate node so it can be retracted in flight) ──
  b.inGroup('gear', () => {
    const g = s.gear;
    if (!g.inNacelle) {
      const mz = leAt(g.mainX) - chordAt(g.mainX) * 0.55 + (g.mainDz ?? 0);
      for (const side of [1, -1]) {
        const x = side * g.mainX;
        const top = g.sponson ? botAt(mz) + 0.4 : wyAt(g.mainX);
        gearLeg(b, x, top, mz, g.tyre, g.mainWheels);
      }
      if (g.body) {
        for (const side of [1, -1]) gearLeg(b, side * g.body.x, botAt(mz + g.body.dz) + 0.3, mz + g.body.dz, g.tyre, g.body.wheels);
      }
    }
    const nz = z1 - g.noseFromTip;
    gearLeg(b, 0, botAt(nz) + 0.2, nz, g.noseTyre, 2, true);
  });
  if (s.gear.sponson) {
    const mz = leAt(s.gear.mainX) - chordAt(s.gear.mainX) * 0.55 + (s.gear.mainDz ?? 0);
    for (const side of [1, -1]) {
      const pst: Station[] = [0, 0.15, 0.4, 0.7, 0.9, 1].map((t) => [mz - 2.6 + 5.2 * t, Math.max(0.03, 0.62 * Rv * 0.5 * sup(t < 0.4 ? t / 0.4 : (1 - t) / 0.6, 2)), s.belly + 0.42, 1.1]);
      b.lathe('fairing', pst, 16, [side * R * 0.72, 0, 0]);
    }
  }

  // ── Lights ──
  const lightR = Math.max(0.06, R * 0.035);
  b.sphere('navRed', [tip.x + 0.05, tip.y, tip.z - tip.c * 0.15], lightR);
  b.sphere('navGreen', [-tip.x - 0.05, tip.y, tip.z - tip.c * 0.15], lightR);
  b.sphere('navWhite', [0, stations[0][2] ?? yc, z0 - 0.02], lightR);
  b.sphere('navRed', [0, yc + Rv + lightR * 0.6, zLEroot - w.root * 0.3], lightR);
  b.sphere('navRed', [0, yc - Rv - lightR * 0.6, zLEroot - w.root * 0.6], lightR);

  const height = Math.max(finTop + f.tip * 0.1, sb.t ? sy + 0.3 : 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const lights: ModelLights = {
    tip: [r2(tip.z - tip.c * 0.3), r2(tip.x + 0.05), r2(tip.y + 0.1)],
    tail: [r2(z0 - 0.1), 0, r2(stations[0][2] ?? yc)],
    top: [r2(zLEroot - w.root * 0.3), 0, r2(yc + Rv + 0.25)],
    belly: [r2(zLEroot - w.root * 0.6), 0, r2(yc - Rv - 0.25)],
    land: [r2(zLEroot - w.root * 0.12), r2(R * 1.25), r2(wyAt(R * 1.25))],
  };
  return { b, textures, length: L, span: w.span, height, lights };
}

// ── Texture layers ──────────────────────────────────────────────────────────

function windscreenLayer(nose: NoseDef, z1: number, yc: number, R: number, Rv: number): Layer {
  const w = nose.ws;
  const m = w.mask ?? 0;
  const frameM = 0.045;
  const wrapEnd = w.posts[0] ?? (w.d0 + w.d1) / 2;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  /** Inside the windscreen outline, grown by `g` (× R / × Rv) for the A350's black mask. */
  const inside = (d: number, yr: number, crown: number, g: number) => {
    const yb = lerp(w.yb0, w.yb1, (d - w.d0) / (w.d1 - w.d0)) - g;
    if (yr < yb) return false;
    const front = w.d0 + w.fs * clamp((yr - w.yb0) / (w.yt0 - w.yb0), 0, 3) - g;
    if (d < front) return false;
    const rear = w.d1 - w.rs * clamp((yr - w.yb1) / (w.yt1 - w.yb1), 0, 1) + g * 0.6;
    if (d > rear) return false;
    // Front panes wrap over the nose to the centre post; behind the first post only the side windows remain.
    const top = d <= wrapEnd ? crown - 0.012 : lerp(w.yt0, w.yt1, clamp((d - w.d0 - w.fs) / (w.d1 - w.rs - w.d0 - w.fs), 0, 1)) + g * 0.5;
    return yr <= top;
  };
  return (p) => {
    const d = (z1 - p.z) / R;
    if (d < w.d0 - 0.3 || d > w.d1 + 0.3) return undefined;
    const yr = (p.y - yc) / Rv;
    const crown = (p.yc + p.r - yc) / Rv;
    const inGlass = inside(d, yr, crown, 0);
    if (!inGlass) return m && inside(d, yr, crown, m) ? C.mask : undefined;
    const frame = m ? C.mask : C.frame;
    if (Math.abs(p.x) < frameM * 0.8) return frame;
    for (const pd of w.posts) if (Math.abs(d - pd) * R < frameM) return frame;
    if (p.hw > 0 && Math.abs(Math.abs(p.x) / p.hw - w.sp) * p.hw < frameM) return frame;
    return C.glass;
  };
}

function windowLayer(win: AirlinerSpec['windows'], z1: number, y: number, doors: AirlinerSpec['doors'], oval?: boolean): Layer {
  const n = Math.max(0, Math.floor((win.to - win.from) / win.pitch) + 1);
  const skip = new Set<number>();
  for (let k = 0; k < n; k++) {
    const zFromNose = win.from + k * win.pitch;
    for (const d of doors) {
      const dw = d.kind === 'exit' ? 0.52 : d.kind === 'cargo' ? 0 : 0.86;
      if (d.kind !== 'exit' && Math.abs(zFromNose - d.z) < dw / 2 + win.w * 0.9) skip.add(k);
      if (d.kind === 'exit' && Math.abs(zFromNose - d.z) < win.pitch * 0.5) skip.add(k);
    }
  }
  const hw = win.w / 2;
  const hh = win.h / 2;
  const ex = oval ? 2 : 2.7;
  return (p) => {
    const dy = p.y - y;
    if (Math.abs(dy) > hh || Math.abs(p.x) < p.hw * 0.4) return undefined;
    const dn = z1 - p.z;
    const k = Math.round((dn - win.from) / win.pitch);
    if (k < 0 || k >= n || skip.has(k)) return undefined;
    const dz = dn - (win.from + k * win.pitch);
    return inRounded(dz, dy, hw, hh, ex) ? C.window : undefined;
  };
}

function doorLayers(s: AirlinerSpec, z1: number, yc: number, Rv: number, winY: number): Layer[] {
  const out: Layer[] = [];
  for (const d of s.doors) {
    const kind = d.kind ?? 'main';
    const baseY = d.deck === 'upper' && s.windows.upper ? yc + s.windows.upper.y * Rv : winY;
    const w = kind === 'exit' ? 0.52 : kind === 'cargo' ? 1.8 : 0.86;
    const h = kind === 'exit' ? 0.96 : kind === 'cargo' ? 1.7 : 1.88;
    const yb = kind === 'exit' ? baseY - 0.58 : kind === 'cargo' ? yc - Rv * 0.72 : baseY - 1.02;
    const zc = z1 - d.z;
    const t = 0.035;
    const side = kind === 'cargo' ? -1 : 0; // cargo doors on the right (−X) side
    out.push((p) => {
      if (Math.abs(p.x) < p.hw * 0.3 || (side && Math.sign(p.x) !== side)) return undefined;
      const dz = p.z - zc;
      const dy = p.y - (yb + h / 2);
      if (!inRounded(dz, dy, w / 2 + t, h / 2 + t, 5)) return undefined;
      if (!inRounded(dz, dy, w / 2 - t, h / 2 - t, 5)) return C.seam;
      if (kind === 'main' && inRounded(dz, p.y - (baseY + 0.02), 0.1, 0.14, 2.6)) return C.window;
      return undefined;
    });
  }
  return out;
}

// ── Parts ───────────────────────────────────────────────────────────────────

/** Turbofan: cowl with a lip, open inlet with fan face and spinner, bypass and core exhausts, exhaust plug. */
function fan(b: Builder, cx: number, cy: number, zf: number, Rn: number, len: number) {
  const seg = Rn > 1 ? 28 : 20;
  const at = (f: number) => zf - f * len;
  const o: V3 = [cx, cy, 0];
  b.lathe('nacelle', [[at(0.62), Rn * 0.86], [at(0.45), Rn * 0.97], [at(0.25), Rn], [at(0.1), Rn * 0.985], [at(0.035), Rn * 0.955]], seg, o, { caps: false, livery: ZONE.ENGINE });
  b.lathe('lip', [[at(0.035), Rn * 0.955], [at(0.008), Rn * 0.925], [at(0), Rn * 0.885]], seg, o, { caps: false });
  b.lathe('inlet', [[at(0.15), Rn * 0.8], [at(0.05), Rn * 0.84], [at(0), Rn * 0.885]], seg, o, { inside: true });
  b.disc('fan', [cx, cy, at(0.15)], Rn * 0.81, 'z', seg);
  b.lathe('spinner', [[at(0.15), Rn * 0.27], [at(0.11), Rn * 0.22], [at(0.075), Rn * 0.12], [at(0.055), 0.001]], 16, o, { caps: false });
  b.disc('fan', [cx, cy, at(0.62)], Rn * 0.86, 'z', seg, Rn * 0.6);
  b.lathe('core', [[at(0.86), Rn * 0.43], [at(0.74), Rn * 0.55], [at(0.6), Rn * 0.61]], 20, o, { caps: false });
  b.disc('fan', [cx, cy, at(0.86)], Rn * 0.43, 'z', 20, Rn * 0.3);
  b.lathe('exhaust', [[at(1), Rn * 0.03], [at(0.93), Rn * 0.2], [at(0.86), Rn * 0.3]], 16, o, { caps: false });
}

/** Wing-mounted turboprop nacelle with spinner and propeller. */
function prop(b: Builder, cx: number, cy: number, zf: number, Rn: number, len: number, propDia: number, blades: number, wingY: number, side: number) {
  const at = (f: number) => zf - f * len;
  // Nacelle hangs below the wing and rises into it towards the rear.
  const st: Station[] = [
    [at(1), Rn * 0.32, wingY - cy + Rn * 0.05, 0.9],
    [at(0.8), Rn * 0.66, (wingY - cy) * 0.55, 0.85],
    [at(0.55), Rn * 0.95, (wingY - cy) * 0.25, 0.8],
    [at(0.3), Rn, 0, 0.78],
    [at(0.12), Rn * 0.94, 0, 0.78],
    [at(0.03), Rn * 0.78, 0, 0.8],
    [at(0), Rn * 0.64, 0, 0.84],
  ];
  b.lathe('nacelle', st, 20, [cx, cy, 0], { livery: ZONE.ENGINE });
  b.box('exhaust', [cx + side * Rn * 0.62, cy + Rn * 0.2, at(0.38)], [0.12, Rn * 0.45, Rn * 0.7]);
  spinnerAndProp(b, cx, cy, zf, Rn * 0.62, propDia, blades);
}

function spinnerAndProp(b: Builder, cx: number, cy: number, zf: number, rs: number, propDia: number, blades: number) {
  const spl = rs * 1.9;
  b.lathe('spinner', [[zf, rs], [zf + spl * 0.4, rs * 0.86], [zf + spl * 0.75, rs * 0.52], [zf + spl, 0.01]], 18, [cx, cy, 0], { caps: false });
  const zp = zf + spl * 0.3;
  const Rp = propDia / 2;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2 + 0.3;
    const dir: V3 = [Math.cos(a), Math.sin(a), 0];
    const tan: V3 = [-Math.sin(a), Math.cos(a), 0];
    const sec = (r: number, chord: number): V3[] => {
      const c: V3 = [cx + dir[0] * r, cy + dir[1] * r, zp];
      // Blade chord pitched ~55° out of the disc plane.
      const ch: V3 = [tan[0] * chord * 0.57, tan[1] * chord * 0.57, -chord * 0.82];
      const th: V3 = [0, 0, 0.02];
      return [
        [c[0] + ch[0] / 2, c[1] + ch[1] / 2, c[2] + ch[2] / 2],
        [c[0] + th[0], c[1] + th[1], c[2] + th[2] + 0.02],
        [c[0] - ch[0] / 2, c[1] - ch[1] / 2, c[2] - ch[2] / 2],
        [c[0] - th[0], c[1] - th[1], c[2] - th[2] - 0.02],
        [c[0] + ch[0] / 2, c[1] + ch[1] / 2, c[2] + ch[2] / 2],
      ];
    };
    const chord = Math.max(0.12, propDia * 0.075);
    b.loft('blade', [sec(rs * 0.8, chord * 0.9), sec(Rp * 0.55, chord), sec(Rp, chord * 0.45)], { smooth: false });
  }
  b.disc('blur', [cx, cy, zp - 0.05], Rp, 'z', 36, rs * 0.85);
}

/** Landing gear leg: strut from `top` down to the axle, with 2, 4 or 6 wheels. */
function gearLeg(b: Builder, x: number, top: number, z: number, tyre: number, wheels: 2 | 4 | 6, nose = false) {
  const tw = tyre * 0.72;
  const axleY = tyre;
  const strutR = Math.max(0.06, tyre * (nose ? 0.11 : 0.16));
  b.tube('strut', [x, top, z], [x, axleY + (wheels > 2 ? tyre * 0.25 : 0), z], strutR, 10);
  const axles = wheels === 2 ? [0] : wheels === 4 ? [-1.08, 1.08] : [-2.16, 0, 2.16];
  if (wheels > 2) b.tube('strut', [x, axleY, z + axles[0] * tyre], [x, axleY, z + axles[axles.length - 1] * tyre], strutR * 0.8, 8);
  for (const a of axles) {
    const az = z + a * tyre;
    for (const sx of [-1, 1]) {
      const wx = x + sx * (tw / 2 + strutR + 0.04);
      b.cylinderX('tire', [wx, axleY, az], tyre, tw, 16);
      b.cylinderX('hub', [wx + sx * 0.01, axleY, az], tyre * 0.56, tw + 0.02, 12);
    }
  }
}

/** Wingtip devices, drawn for the left tip and mirrored. */
function winglet(b: Builder, style: TipStyle, tip: { x: number; y: number; z: number; c: number }, hIn: number) {
  if (style === 'none' || style === 'raked') return;
  const sections: V3[][] = [];
  const addLower: V3[][] = [];
  const up = (theta: number): V3 => [-Math.sin(theta), Math.cos(theta), 0];
  const path = (h: number, rc: number, finalDeg: number, sweepDeg: number, topChord: number, steps = 5) => {
    const out: V3[][] = [];
    const tanS = Math.tan(sweepDeg * D2R);
    const thetaEnd = finalDeg * D2R;
    let px = tip.x;
    let py = tip.y;
    let travelled = 0;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * thetaEnd;
      px = tip.x + rc * Math.sin(th);
      py = tip.y + rc * (1 - Math.cos(th));
      travelled = py - tip.y;
      const c = lerp(tip.c, tip.c * 0.82, i / steps);
      out.push(airfoil([px, py, tip.z - tanS * travelled], c, 0.085, up(th), 1));
    }
    const remain = Math.max(0.1, h - (py - tip.y));
    const tx = px + Math.cos(thetaEnd) * remain;
    const ty = py + Math.sin(thetaEnd) * remain;
    out.push(airfoil([tx, ty, tip.z - tanS * (ty - tip.y)], tip.c * topChord, 0.08, up(thetaEnd), 1));
    return out;
  };
  switch (style) {
    case 'sharklet':
      sections.push(...path(hIn || 2.4, (hIn || 2.4) * 0.3, 78, 38, 0.32));
      break;
    case 'blended':
      sections.push(...path(hIn || 2.5, (hIn || 2.5) * 0.4, 75, 34, 0.38));
      break;
    case 'split': {
      sections.push(...path(hIn || 2.1, (hIn || 2.1) * 0.2, 80, 48, 0.22));
      const tanS = Math.tan(52 * D2R);
      const hl = (hIn || 2.1) * 0.45;
      const th = -52 * D2R;
      const lowerEnd: V3 = [tip.x + Math.cos(th) * hl * 0.5, tip.y + Math.sin(th) * hl, 0];
      addLower.push(airfoil([tip.x, tip.y - 0.02, tip.z - tip.c * 0.15], tip.c * 0.62, 0.08, up(th), 1));
      addLower.push(airfoil([lowerEnd[0], lowerEnd[1], tip.z - tip.c * 0.15 - tanS * hl], tip.c * 0.2, 0.08, up(th), 1));
      break;
    }
    case 'canted':
      sections.push(...path(hIn || 1.9, (hIn || 1.9) * 0.08, 62, 42, 0.42, 2));
      break;
    case 'curved':
      sections.push(...path(hIn || 3.0, (hIn || 3.0) * 0.85, 68, 40, 0.25, 7));
      break;
    case 'small':
      sections.push(...path(hIn || 1.2, (hIn || 1.2) * 0.3, 75, 40, 0.4, 3));
      break;
    case 'fence': {
      const h = hIn || 0.9;
      const lo = h * 0.6;
      sections.push(
        airfoil([tip.x + 0.02, tip.y, tip.z + tip.c * 0.3], tip.c * 1.3, 0.06, [1, 0, 0], 1),
        airfoil([tip.x + 0.02, tip.y + h, tip.z - tip.c * 0.5], tip.c * 0.4, 0.06, [1, 0, 0], 1),
      );
      addLower.push(
        airfoil([tip.x + 0.02, tip.y, tip.z + tip.c * 0.3], tip.c * 1.3, 0.06, [1, 0, 0], 1),
        airfoil([tip.x + 0.02, tip.y - lo, tip.z - tip.c * 0.15], tip.c * 0.5, 0.06, [1, 0, 0], 1),
      );
      break;
    }
  }
  for (const secs of [sections, addLower]) {
    if (secs.length < 2) continue;
    b.loft('livery', secs, { livery: 1 });
    b.loft('livery', secs.map((s) => s.map(mirror)), { livery: 1 });
  }
}

export type { RGB };
