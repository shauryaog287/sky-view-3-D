import { angleDiff, clamp, KT_TO_MS, lerp, lerpAngle, norm360, offsetLatLon, smoothstep, toDeg, toRad } from '../../shared/geo';

/**
 * Live-motion smoothing: dead reckoning + projective velocity blending (PVB).
 *
 * Every fix (1–10 s apart) becomes a Kinematic state. Between fixes we extrapolate along a constant-turn arc
 * (ground speed, track, turn rate, vertical rate). When a new fix arrives we do NOT jump: for `blendMs` (~1 s)
 * we blend from "where we were heading" to "where the new fix says we are heading", both extrapolated to the
 * current frame time. Position and velocity stay continuous, so there is no teleporting and no rubber-banding.
 *
 * Pure TypeScript (no Cesium), so it is unit-tested and also used for replay previews.
 */
export interface Kinematic {
  /** Client-clock epoch ms of this state. */
  t: number;
  lat: number;
  lon: number;
  /** Feet (pressure/geometric altitude); null when on the ground. */
  altFt: number | null;
  gsKt: number;
  /** Degrees true. */
  track: number;
  vrateFpm: number;
  /** Degrees per second, positive = right turn. */
  turnRate: number;
  /** Degrees, positive = right wing down. */
  roll: number;
}

export interface Pose {
  lat: number;
  lon: number;
  altFt: number | null;
  /** Degrees true. */
  heading: number;
  /** Degrees, nose up positive. */
  pitch: number;
  /** Degrees, right wing down positive. */
  roll: number;
  gsKt: number;
  vrateFpm: number;
  /** True when we are predicting past the dead-reckoning horizon (aircraft frozen). */
  frozen: boolean;
}

export interface SmootherOptions {
  /** Blend duration after each new fix. */
  blendMs: number;
  /** Stop extrapolating horizontally after this long without a fix. */
  maxExtrapolationMs: number;
  /** Only continue a turn for this long (aircraft roll out of turns; avoids predicted circles). */
  maxTurnMs: number;
  /** Only continue a climb/descent for this long. */
  maxVerticalMs: number;
}

export const DEFAULT_SMOOTHER: SmootherOptions = {
  blendMs: 1000,
  maxExtrapolationMs: 60_000,
  maxTurnMs: 12_000,
  maxVerticalMs: 30_000,
};

const G = 9.80665;

/** Position along a constant-turn arc then straight, `dtMs` after state k. */
export function extrapolate(k: Kinematic, atMs: number, o: SmootherOptions = DEFAULT_SMOOTHER): { lat: number; lon: number; altFt: number | null; track: number; frozen: boolean } {
  const dtMs = clamp(atMs - k.t, 0, o.maxExtrapolationMs);
  const dt = dtMs / 1000;
  const v = k.gsKt * KT_TO_MS;
  const turnS = Math.min(dt, o.maxTurnMs / 1000);
  const straightS = dt - turnS;
  const omega = toRad(k.turnRate);
  const psi0 = toRad(k.track);
  let east: number;
  let north: number;
  let psi1: number;
  if (Math.abs(k.turnRate) < 0.01 || v < 1) {
    east = v * turnS * Math.sin(psi0);
    north = v * turnS * Math.cos(psi0);
    psi1 = psi0;
  } else {
    psi1 = psi0 + omega * turnS;
    const r = v / omega;
    east = r * (Math.cos(psi0) - Math.cos(psi1));
    north = r * (Math.sin(psi1) - Math.sin(psi0));
  }
  east += v * straightS * Math.sin(psi1);
  north += v * straightS * Math.cos(psi1);
  const p = offsetLatLon(k.lat, k.lon, east, north);
  const vertS = Math.min(dt, o.maxVerticalMs / 1000);
  const altFt = k.altFt === null ? null : k.altFt + (k.vrateFpm * vertS) / 60;
  return { lat: p.lat, lon: p.lon, altFt, track: norm360(toDeg(psi1)), frozen: atMs - k.t > o.maxExtrapolationMs };
}

/** Bank angle for a coordinated turn: tan(φ) = v·ω / g. */
export function bankFromTurn(gsKt: number, turnRateDegS: number): number {
  const v = gsKt * KT_TO_MS;
  return clamp(toDeg(Math.atan((v * toRad(turnRateDegS)) / G)), -35, 35);
}

/** Pitch ≈ flight-path angle + a small angle-of-attack bias while airborne. */
export function pitchFromVertical(gsKt: number, vrateFpm: number, onGround: boolean): number {
  if (onGround) return 0;
  const v = Math.max(60, gsKt) * KT_TO_MS;
  const vz = (vrateFpm * 0.3048) / 60;
  const gamma = toDeg(Math.atan2(vz, v));
  return clamp(gamma + 2.5, -8, 18);
}

export interface FixInput {
  t: number;
  lat: number;
  lon: number;
  altFt: number | null;
  gsKt?: number;
  track?: number;
  vrateFpm?: number;
  /** Reported track rate (deg/s) when the feed provides it. */
  trackRate?: number;
  /** Reported roll when the feed provides it. */
  roll?: number;
}

/** Smooths one aircraft. Feed it fixes with `update`, read 60 fps poses with `sample`. */
export class MotionTrack {
  private from?: Kinematic;
  private to?: Kinematic;
  private blendStart = 0;
  private lastFix?: FixInput;

  constructor(private readonly o: SmootherOptions = DEFAULT_SMOOTHER) {}

  get latest(): Kinematic | undefined {
    return this.to;
  }

  get lastFixTime(): number {
    return this.to?.t ?? 0;
  }

  /** Add a new position fix. `now` is the current client time (when the blend starts). */
  update(fix: FixInput, now: number): void {
    if (this.to && fix.t <= this.to.t) return; // duplicate or out-of-order
    const prev = this.lastFix;
    // Estimate what the feed does not provide from consecutive fixes.
    let track = fix.track;
    let gsKt = fix.gsKt;
    let turnRate = fix.trackRate;
    let vrate = fix.vrateFpm;
    if (prev) {
      const dt = (fix.t - prev.t) / 1000;
      if (dt > 0.5 && dt < 30) {
        if (turnRate === undefined && track !== undefined && prev.track !== undefined) {
          turnRate = clamp(angleDiff(prev.track, track) / dt, -6, 6);
        }
        if (vrate === undefined && fix.altFt !== null && prev.altFt !== null) {
          vrate = ((fix.altFt - prev.altFt) / dt) * 60;
        }
      }
    }
    turnRate = turnRate ?? 0;
    const gs = gsKt ?? this.to?.gsKt ?? 0;
    const k: Kinematic = {
      t: fix.t,
      lat: fix.lat,
      lon: fix.lon,
      altFt: fix.altFt,
      gsKt: gs,
      track: track ?? this.to?.track ?? 0,
      vrateFpm: fix.altFt === null ? 0 : (vrate ?? 0),
      turnRate: Math.abs(turnRate) < 0.05 ? 0 : turnRate,
      roll: fix.roll ?? bankFromTurn(gs, turnRate),
    };
    if (this.to) {
      // Snapshot the currently rendered state; it becomes the blend origin.
      this.from = this.snapshot(now);
      this.blendStart = now;
    }
    this.to = k;
    this.lastFix = fix;
  }

  /** Current blended kinematic state at time `now` (used as the next blend origin). */
  private snapshot(now: number): Kinematic {
    const p = this.sample(now);
    const s = this.blendFactor(now);
    const a = this.from;
    const b = this.to!;
    return {
      t: now,
      lat: p.lat,
      lon: p.lon,
      altFt: p.altFt,
      gsKt: a ? lerp(a.gsKt, b.gsKt, s) : b.gsKt,
      track: p.heading,
      vrateFpm: a ? lerp(a.vrateFpm, b.vrateFpm, s) : b.vrateFpm,
      turnRate: a ? lerp(a.turnRate, b.turnRate, s) : b.turnRate,
      roll: p.roll,
    };
  }

  private blendFactor(now: number): number {
    if (!this.from) return 1;
    return smoothstep((now - this.blendStart) / this.o.blendMs);
  }

  sample(now: number): Pose {
    const b = this.to;
    if (!b) throw new Error('MotionTrack.sample before first update');
    const pb = extrapolate(b, now, this.o);
    const s = this.blendFactor(now);
    let lat = pb.lat;
    let lon = pb.lon;
    let altFt = pb.altFt;
    let heading = pb.track;
    let roll = b.roll;
    let gs = b.gsKt;
    let vr = b.vrateFpm;
    const a = this.from;
    if (a && s < 1) {
      const pa = extrapolate(a, now, this.o);
      lat = lerp(pa.lat, pb.lat, s);
      let dLon = pb.lon - pa.lon;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      lon = pa.lon + dLon * s;
      altFt = pa.altFt === null || pb.altFt === null ? pb.altFt : lerp(pa.altFt, pb.altFt, s);
      heading = lerpAngle(pa.track, pb.track, s);
      roll = lerp(a.roll, b.roll, s);
      gs = lerp(a.gsKt, b.gsKt, s);
      vr = lerp(a.vrateFpm, b.vrateFpm, s);
    } else if (a && s >= 1) {
      this.from = undefined;
    }
    // Roll out of turns once we stop predicting them.
    if (now - b.t > this.o.maxTurnMs) roll *= Math.max(0, 1 - (now - b.t - this.o.maxTurnMs) / 3000);
    const vertActive = now - b.t < this.o.maxVerticalMs;
    const onGround = altFt === null;
    return {
      lat,
      lon,
      altFt,
      heading,
      pitch: pitchFromVertical(gs, vertActive ? vr : 0, onGround),
      roll: onGround ? 0 : roll,
      gsKt: gs,
      vrateFpm: vertActive ? vr : 0,
      frozen: pb.frozen,
    };
  }
}
