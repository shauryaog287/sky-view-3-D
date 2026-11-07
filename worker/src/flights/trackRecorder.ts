import type { AircraftState, TrackPoint } from '../../../shared/types';
import { angleDiff } from '../../../shared/geo';

export interface TrackSink {
  write(points: TrackPoint[]): Promise<void>;
}

export interface TrackRecorderOptions {
  /** Minimum spacing between stored points for one aircraft on a steady course. */
  minIntervalMs?: number;
  /** Store sooner than minIntervalMs when the aircraft turns or changes altitude a lot. */
  turnThresholdDeg?: number;
  altThresholdFt?: number;
  maxBuffer?: number;
}

/**
 * Turns the stream of polled aircraft into sparse track points (hex, ts, lat, lon, alt, gs, track, vrate).
 * Steady flight is sampled every ~15 s; turns, climbs and descents are sampled more densely (≥ 4 s apart),
 * which keeps D1 writes low while replays still interpolate smoothly.
 */
export class TrackRecorder {
  private readonly last = new Map<string, { ts: number; track?: number; alt?: number }>();
  private buffer: TrackPoint[] = [];
  private readonly minInterval: number;
  private readonly turnThreshold: number;
  private readonly altThreshold: number;
  readonly maxBuffer: number;

  constructor(
    private readonly sink: TrackSink,
    opts: TrackRecorderOptions = {},
  ) {
    this.minInterval = opts.minIntervalMs ?? 15_000;
    this.turnThreshold = opts.turnThresholdDeg ?? 8;
    this.altThreshold = opts.altThresholdFt ?? 700;
    this.maxBuffer = opts.maxBuffer ?? 2000;
  }

  observe(list: AircraftState[]) {
    for (const a of list) {
      const prev = this.last.get(a.hex);
      const alt = a.onGround ? undefined : (a.altBaro ?? a.altGeom);
      if (prev) {
        const dt = a.posTs - prev.ts;
        if (dt <= 0) continue;
        const turned = a.track !== undefined && prev.track !== undefined && Math.abs(angleDiff(prev.track, a.track)) >= this.turnThreshold;
        const climbed = alt !== undefined && prev.alt !== undefined && Math.abs(alt - prev.alt) >= this.altThreshold;
        if (dt < this.minInterval && !((turned || climbed) && dt >= 4000)) continue;
      }
      this.last.set(a.hex, { ts: a.posTs, track: a.track, alt });
      this.buffer.push({
        hex: a.hex,
        ts: a.posTs,
        lat: Math.round(a.lat * 1e5) / 1e5,
        lon: Math.round(a.lon * 1e5) / 1e5,
        alt: alt ?? null,
        gs: a.gs ?? null,
        track: a.track ?? null,
        vrate: a.vrate ?? null,
      });
    }
    if (this.buffer.length > this.maxBuffer) this.buffer = this.buffer.slice(-this.maxBuffer);
  }

  get pending(): number {
    return this.buffer.length;
  }

  /** Write buffered points. Points are dropped (not retried forever) if the sink fails twice. */
  async flush(): Promise<number> {
    if (!this.buffer.length) return 0;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.sink.write(batch);
    } catch {
      try {
        await this.sink.write(batch);
      } catch (e) {
        console.warn('[tracks] flush failed, dropping', batch.length, 'points', e);
        return 0;
      }
    }
    return batch.length;
  }

  /** Forget aircraft not seen for a while so memory stays bounded. */
  prune(now: number, idleMs = 30 * 60_000) {
    for (const [hex, v] of this.last) if (now - v.ts > idleMs) this.last.delete(hex);
  }
}
