import { describe, expect, it } from 'vitest';
import { bankFromTurn, extrapolate, MotionTrack, pitchFromVertical, type Kinematic } from './smoother';
import { angleDiff, destinationPoint, haversineM, KT_TO_MS } from '../../shared/geo';

const k0: Kinematic = { t: 0, lat: 28.5, lon: 77.1, altFt: 10000, gsKt: 300, track: 0, vrateFpm: 0, turnRate: 0, roll: 0 };

describe('extrapolate', () => {
  it('flies straight at ground speed', () => {
    const p = extrapolate(k0, 10_000);
    expect(haversineM(k0.lat, k0.lon, p.lat, p.lon)).toBeCloseTo(300 * KT_TO_MS * 10, -1);
    expect(p.lat).toBeGreaterThan(k0.lat);
    expect(p.track).toBe(0);
  });

  it('follows a constant-rate turn, then rolls out straight', () => {
    const k = { ...k0, gsKt: 200, track: 90, turnRate: 3 };
    const p = extrapolate(k, 12_000);
    expect(p.track).toBeCloseTo(126, 5);
    // Chord of a 36° arc is shorter than the straight-line distance.
    const straight = 200 * KT_TO_MS * 12;
    const d = haversineM(k.lat, k.lon, p.lat, p.lon);
    expect(d).toBeLessThan(straight);
    expect(d).toBeGreaterThan(straight * 0.95);
    // After maxTurnMs (12 s) the heading stays constant.
    expect(extrapolate(k, 30_000).track).toBeCloseTo(126, 5);
  });

  it('limits vertical extrapolation and freezes after the horizon', () => {
    const k = { ...k0, vrateFpm: -1200 };
    expect(extrapolate(k, 30_000).altFt).toBeCloseTo(10000 - 600, 5);
    expect(extrapolate(k, 120_000).altFt).toBeCloseTo(10000 - 600, 5);
    expect(extrapolate(k, 120_000).frozen).toBe(true);
  });
});

describe('MotionTrack', () => {
  it('never teleports: a corrected fix is blended in over ~1 s', () => {
    const m = new MotionTrack();
    m.update({ t: 0, lat: 28.5, lon: 77.1, altFt: 10000, gsKt: 300, track: 0 }, 0);
    const before = m.sample(5000);
    // New fix: 400 m east of where we predicted.
    const predicted = destinationPoint(28.5, 77.1, 0, 300 * KT_TO_MS * 5);
    const corrected = destinationPoint(predicted.lat, predicted.lon, 90, 400);
    m.update({ t: 5000, lat: corrected.lat, lon: corrected.lon, altFt: 10000, gsKt: 300, track: 0 }, 5000);
    const at = m.sample(5000);
    expect(haversineM(before.lat, before.lon, at.lat, at.lon)).toBeLessThan(1);
    // After the blend window we are on the new extrapolation.
    const after = m.sample(6100);
    const target = destinationPoint(corrected.lat, corrected.lon, 0, 300 * KT_TO_MS * 1.1);
    expect(haversineM(after.lat, after.lon, target.lat, target.lon)).toBeLessThan(2);
  });

  it('keeps per-frame motion smooth with noisy fixes every 5 s', () => {
    const m = new MotionTrack();
    let maxStep = 0;
    let prev: { lat: number; lon: number } | undefined;
    let truth = { lat: 19.0, lon: 72.8 };
    let heading = 45;
    for (let frame = 0; frame <= 60 * 30; frame++) {
      const t = (frame * 1000) / 60;
      if (frame % 300 === 0) {
        // Truth moves 5 s at 250 kt with a slow turn; report it with ±60 m noise.
        if (frame > 0) {
          heading += 5;
          truth = destinationPoint(truth.lat, truth.lon, heading, 250 * KT_TO_MS * 5);
        }
        const noisy = destinationPoint(truth.lat, truth.lon, (frame * 37) % 360, 60);
        m.update({ t, lat: noisy.lat, lon: noisy.lon, altFt: 8000, gsKt: 250, track: heading }, t);
      }
      const p = m.sample(t);
      if (prev) maxStep = Math.max(maxStep, haversineM(prev.lat, prev.lon, p.lat, p.lon));
      prev = p;
    }
    const nominal = (250 * KT_TO_MS) / 60; // ≈ 2.14 m per frame
    expect(maxStep).toBeLessThan(nominal * 2.2);
  });

  it('ignores duplicate and out-of-order fixes', () => {
    const m = new MotionTrack();
    m.update({ t: 1000, lat: 1, lon: 1, altFt: 1000, gsKt: 100, track: 0 }, 1000);
    m.update({ t: 500, lat: 2, lon: 2, altFt: 1000, gsKt: 100, track: 0 }, 1200);
    expect(m.latest?.lat).toBe(1);
  });

  it('estimates turn rate and vertical rate from consecutive fixes when the feed lacks them', () => {
    const m = new MotionTrack();
    m.update({ t: 0, lat: 0, lon: 0, altFt: 5000, gsKt: 200, track: 10 }, 0);
    m.update({ t: 5000, lat: 0.01, lon: 0, altFt: 5100, gsKt: 200, track: 25 }, 5000);
    expect(m.latest?.turnRate).toBeCloseTo(3, 5);
    expect(m.latest?.vrateFpm).toBeCloseTo(1200, 5);
    expect(m.latest?.roll).toBeGreaterThan(10);
  });

  it('shortest-arc heading blend across north', () => {
    const m = new MotionTrack();
    m.update({ t: 0, lat: 0, lon: 0, altFt: 5000, gsKt: 200, track: 355, trackRate: 0 }, 0);
    m.update({ t: 1000, lat: 0.001, lon: 0, altFt: 5000, gsKt: 200, track: 5, trackRate: 0 }, 1000);
    const mid = m.sample(1500).heading;
    expect(Math.abs(angleDiff(0, mid))).toBeLessThan(6);
  });
});

describe('attitude', () => {
  it('banks for turns and pitches for climbs', () => {
    expect(bankFromTurn(140, 3)).toBeCloseTo(21, 0);
    expect(bankFromTurn(450, 3)).toBe(35);
    expect(bankFromTurn(250, -3)).toBeLessThan(-20);
    expect(pitchFromVertical(150, -750, false)).toBeCloseTo(-0.3, 0); // 3° glide + AoA bias
    expect(pitchFromVertical(160, 2500, false)).toBeGreaterThan(10);
    expect(pitchFromVertical(20, 0, true)).toBe(0);
  });
});
