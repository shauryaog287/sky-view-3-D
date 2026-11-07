import { signal } from '@preact/signals';
import type { AircraftState } from '../../shared/types';
import { MotionTrack } from '../motion/smoother';
import { modelClassFor, type ModelClass } from '../../shared/aircraftTypes';

export interface LiveAircraft {
  hex: string;
  /** Latest raw report (provider units). */
  state: AircraftState;
  motion: MotionTrack;
  modelClass: ModelClass;
  /** Client time of the last ingested fix. */
  lastUpdate: number;
  firstSeen: number;
}

/**
 * Every aircraft currently known to the client. Positions are NOT reactive (the scene reads them every frame);
 * `version` bumps only when aircraft are added/removed so lists and counts can re-render cheaply.
 */
export class AircraftStore {
  readonly map = new Map<string, LiveAircraft>();
  readonly version = signal(0);
  readonly count = signal(0);
  /** server time − client time, smoothed (ms). Converts provider timestamps to the client clock. */
  private clockOffset: number | undefined;
  /** Aircraft that must never be pruned while far from the view (followed / selected). */
  readonly pinned = new Set<string>();

  noteServerTime(serverNow: number, clientNow: number) {
    const off = serverNow - clientNow;
    this.clockOffset = this.clockOffset === undefined ? off : this.clockOffset * 0.8 + off * 0.2;
  }

  toClient(serverMs: number): number {
    return serverMs - (this.clockOffset ?? 0);
  }

  ingest(list: AircraftState[], now = performance.timeOrigin + performance.now()) {
    let changed = false;
    for (const s of list) {
      let a = this.map.get(s.hex);
      const fixT = Math.min(this.toClient(s.posTs), now);
      if (!a) {
        a = { hex: s.hex, state: s, motion: new MotionTrack(), modelClass: modelClassFor(s.type, s.category), lastUpdate: now, firstSeen: now };
        this.map.set(s.hex, a);
        changed = true;
      } else if (s.posTs < a.state.posTs) {
        continue;
      } else {
        // Keep enrichment fields if this report lacks them.
        a.state = { ...a.state, ...stripUndefined(s) };
        if (!a.state.type && s.type) a.modelClass = modelClassFor(s.type, s.category);
        a.lastUpdate = now;
      }
      a.motion.update(
        {
          t: fixT,
          lat: s.lat,
          lon: s.lon,
          altFt: s.onGround ? null : (s.altGeom ?? s.altBaro ?? null),
          gsKt: s.gs,
          track: s.track,
          vrateFpm: s.vrate,
          trackRate: s.trackRate,
          roll: s.roll,
        },
        now,
      );
    }
    if (changed) this.bump();
  }

  /** Remove aircraft we have not heard about for `maxAgeMs` (unless pinned). */
  prune(now: number, maxAgeMs = 90_000, keep?: (a: LiveAircraft) => boolean) {
    let changed = false;
    for (const [hex, a] of this.map) {
      if (this.pinned.has(hex) && now - a.lastUpdate < 10 * 60_000) continue;
      if (now - a.lastUpdate > maxAgeMs && !(keep?.(a) ?? false)) {
        this.map.delete(hex);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  get(hex: string | null | undefined): LiveAircraft | undefined {
    return hex ? this.map.get(hex) : undefined;
  }

  private bump() {
    this.version.value++;
    this.count.value = this.map.size;
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export const aircraftStore = new AircraftStore();

export function nowMs(): number {
  return performance.timeOrigin + performance.now();
}
