import { describe, expect, it } from 'vitest';
import { MotionTrack } from './smoother';

/**
 * CPU budget check for the per-frame motion work with 200 aircraft (the quality target).
 * At 60 fps a frame has 16.7 ms; motion sampling must stay a small fraction of that (GPU work dominates).
 */
describe('per-frame motion budget', () => {
  it('samples 200 aircraft well under 2 ms per frame', () => {
    const tracks: MotionTrack[] = [];
    for (let i = 0; i < 200; i++) {
      const m = new MotionTrack();
      m.update({ t: 0, lat: 20 + i * 0.01, lon: 77, altFt: 30000, gsKt: 450, track: i % 360, trackRate: i % 2 ? 1.5 : 0 }, 0);
      m.update({ t: 4000, lat: 20.01 + i * 0.01, lon: 77.01, altFt: 30100, gsKt: 452, track: (i + 3) % 360 }, 4000);
      tracks.push(m);
    }
    const frames = 300;
    const start = performance.now();
    let sink = 0;
    for (let f = 0; f < frames; f++) {
      const now = 4000 + f * 16.7;
      for (const m of tracks) sink += m.sample(now).lat;
    }
    const perFrame = (performance.now() - start) / frames;
    expect(sink).not.toBeNaN();
    console.log(`motion sampling: ${perFrame.toFixed(3)} ms per frame for 200 aircraft`);
    expect(perFrame).toBeLessThan(2);
  });
});
