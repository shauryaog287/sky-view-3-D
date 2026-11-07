import type { TrackPoint } from '../../shared/types';
import { angleDiff, clamp, enuOffsetM, FT_TO_M, KT_TO_MS, norm360, offsetLatLon, toDeg } from '../../shared/geo';
import { bankFromTurn, pitchFromVertical, type Pose } from './smoother';

/**
 * Replay interpolation. Unlike live data, every sample is known in advance, so we can use cubic Hermite splines:
 * positions at the samples, velocities (tangents) from the recorded ground speed / track / vertical rate when present,
 * otherwise from neighbouring samples (Catmull-Rom). Gaps longer than `maxGapS` are interpolated linearly instead, so
 * missing data never produces loops.
 */
interface Prepared {
  t: number;
  lat: number;
  lon: number;
  altM: number | null;
  ve: number;
  vn: number;
  vu: number;
  gsKt: number;
}

export class HermiteTrack {
  readonly points: Prepared[];
  readonly start: number;
  readonly end: number;

  constructor(
    raw: TrackPoint[],
    private readonly maxGapS = 120,
  ) {
    const pts = [...raw].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).sort((a, b) => a.ts - b.ts);
    const dedup = pts.filter((p, i) => i === 0 || p.ts > pts[i - 1].ts);
    this.points = dedup.map((p, i) => {
      const prev = dedup[i - 1];
      const next = dedup[i + 1];
      let ve: number;
      let vn: number;
      if (p.gs !== null && p.track !== null) {
        const v = p.gs * KT_TO_MS;
        ve = v * Math.sin((p.track * Math.PI) / 180);
        vn = v * Math.cos((p.track * Math.PI) / 180);
      } else {
        const a = prev ?? p;
        const b = next ?? p;
        const dt = (b.ts - a.ts) / 1000 || 1;
        const d = enuOffsetM(a.lat, a.lon, b.lat, b.lon);
        ve = d.east / dt;
        vn = d.north / dt;
      }
      let vu = p.vrate !== null ? (p.vrate * FT_TO_M) / 60 : 0;
      if (p.vrate === null && prev && next && prev.alt !== null && next.alt !== null) {
        vu = ((next.alt - prev.alt) * FT_TO_M) / ((next.ts - prev.ts) / 1000);
      }
      return { t: p.ts, lat: p.lat, lon: p.lon, altM: p.alt === null ? null : p.alt * FT_TO_M, ve, vn, vu, gsKt: p.gs ?? Math.hypot(ve, vn) / KT_TO_MS };
    });
    this.start = this.points[0]?.t ?? 0;
    this.end = this.points[this.points.length - 1]?.t ?? 0;
  }

  get length() {
    return this.points.length;
  }

  private segment(t: number): number {
    const p = this.points;
    let lo = 0;
    let hi = p.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (p[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** Position, altitude and velocity at time t (clamped to the recorded range). */
  at(tIn: number): { lat: number; lon: number; altM: number | null; ve: number; vn: number; vu: number; gsKt: number } {
    const p = this.points;
    if (p.length === 0) throw new Error('empty track');
    if (p.length === 1 || tIn <= this.start) return { ...p[0] };
    if (tIn >= this.end) return { ...p[p.length - 1] };
    const i = this.segment(tIn);
    const a = p[i];
    const b = p[i + 1];
    const h = (b.t - a.t) / 1000;
    const s = clamp((tIn - a.t) / (b.t - a.t), 0, 1);
    const d = enuOffsetM(a.lat, a.lon, b.lat, b.lon);
    let e: number;
    let n: number;
    let ve: number;
    let vn: number;
    if (h > this.maxGapS) {
      e = d.east * s;
      n = d.north * s;
      ve = d.east / h;
      vn = d.north / h;
    } else {
      const s2 = s * s;
      const s3 = s2 * s;
      // Hermite basis (h00 multiplies the start point, which is the local origin, so it drops out).
      const h10 = s3 - 2 * s2 + s;
      const h01 = -2 * s3 + 3 * s2;
      const h11 = s3 - s2;
      e = h10 * h * a.ve + h01 * d.east + h11 * h * b.ve;
      n = h10 * h * a.vn + h01 * d.north + h11 * h * b.vn;
      // Derivatives of the Hermite basis give the velocity.
      const d10 = 3 * s2 - 4 * s + 1;
      const d01 = (-6 * s2 + 6 * s) / h;
      const d11 = 3 * s2 - 2 * s;
      ve = d10 * a.ve + d01 * d.east + d11 * b.ve;
      vn = d10 * a.vn + d01 * d.north + d11 * b.vn;
    }
    const pos = offsetLatLon(a.lat, a.lon, e, n);
    let altM: number | null;
    if (a.altM === null || b.altM === null) altM = s < 0.5 ? a.altM : b.altM;
    else if (h > this.maxGapS) altM = a.altM + (b.altM - a.altM) * s;
    else {
      const s2 = s * s;
      const s3 = s2 * s;
      altM = (2 * s3 - 3 * s2 + 1) * a.altM + (s3 - 2 * s2 + s) * h * a.vu + (-2 * s3 + 3 * s2) * b.altM + (s3 - s2) * h * b.vu;
    }
    const vu = a.altM !== null && b.altM !== null ? (b.altM - a.altM) / h : 0;
    return { lat: pos.lat, lon: pos.lon, altM, ve, vn, vu, gsKt: a.gsKt + (b.gsKt - a.gsKt) * s };
  }

  /** Full pose (with heading, bank from turn rate, pitch from climb) for rendering. */
  pose(t: number): Pose {
    const c = this.at(t);
    const c2 = this.at(Math.min(this.end, t + 2000));
    const heading = norm360(toDeg(Math.atan2(c.ve, c.vn)));
    const heading2 = norm360(toDeg(Math.atan2(c2.ve, c2.vn)));
    const turnRate = angleDiff(heading, heading2) / 2;
    const vrateFpm = (c.vu / FT_TO_M) * 60;
    const onGround = c.altM === null;
    return {
      lat: c.lat,
      lon: c.lon,
      altFt: c.altM === null ? null : c.altM / FT_TO_M,
      heading,
      pitch: pitchFromVertical(c.gsKt, vrateFpm, onGround),
      roll: onGround ? 0 : bankFromTurn(c.gsKt, turnRate),
      gsKt: c.gsKt,
      vrateFpm,
      frozen: false,
    };
  }
}
