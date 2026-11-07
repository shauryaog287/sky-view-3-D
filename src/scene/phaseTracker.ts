import { detectPhase, type PhaseMemory } from '../../shared/phase';
import type { RunwayMatch, AirportIndex, Airport } from '../../shared/airports';
import type { FlightPhase } from '../../shared/types';
import { lerp } from '../../shared/geo';
import type { AircraftStore, LiveAircraft } from '../state/aircraftStore';
import { flightPhases } from '../state/phases';
import type { GroundHeights } from './ground';
import { nowMs } from '../state/aircraftStore';

export interface TrackedPhase {
  phase: FlightPhase;
  runway?: RunwayMatch;
  /** Airport whose ground reference is used for this aircraft's render height. */
  ref?: Airport;
  aglFt?: number;
  memory: PhaseMemory;
  /** Current / target altitude→render-height offset (m), blended to avoid jumps when the reference airport changes. */
  offsetM: number;
  targetOffsetM: number;
}

export type PhaseListener = (hex: string, prev: FlightPhase | undefined, next: FlightPhase, t: TrackedPhase) => void;

/**
 * Runs phase detection for every aircraft about once per second and keeps per-aircraft airport references used for
 * render heights and ground cameras. Publishes phases to the `flightPhases` signal (only when they change).
 */
export class PhaseTracker {
  private readonly tracked = new Map<string, TrackedPhase>();
  private timer?: ReturnType<typeof setInterval>;
  private airports?: AirportIndex;
  private readonly listeners = new Set<PhaseListener>();

  constructor(
    private readonly store: AircraftStore,
    private readonly ground: GroundHeights,
  ) {}

  setAirports(a: AirportIndex) {
    this.airports = a;
  }

  get airportIndex(): AirportIndex | undefined {
    return this.airports;
  }

  onPhaseChange(fn: PhaseListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  get(hex: string | null | undefined): TrackedPhase | undefined {
    return hex ? this.tracked.get(hex) : undefined;
  }

  tick(now = nowMs()) {
    if (!this.airports) return;
    const changed: Record<string, FlightPhase> = {};
    let any = false;
    for (const a of this.store.map.values()) {
      const t = this.evaluate(a, now);
      if (t && flightPhases.value[a.hex] !== t.phase) {
        changed[a.hex] = t.phase;
        any = true;
      }
    }
    for (const hex of this.tracked.keys()) if (!this.store.map.has(hex)) this.tracked.delete(hex);
    if (any || Object.keys(flightPhases.value).length !== this.tracked.size) {
      const next: Record<string, FlightPhase> = {};
      for (const [hex, t] of this.tracked) next[hex] = changed[hex] ?? t.phase;
      flightPhases.value = next;
    }
  }

  private evaluate(a: LiveAircraft, now: number): TrackedPhase | undefined {
    const pose = a.motion.sample(now);
    const prev = this.tracked.get(a.hex);
    const r = detectPhase(
      {
        t: now,
        lat: pose.lat,
        lon: pose.lon,
        onGround: pose.altFt === null,
        altFt: pose.altFt ?? undefined,
        gsKt: pose.gsKt,
        vrateFpm: pose.vrateFpm,
        track: pose.heading,
      },
      this.airports,
      prev?.memory,
    );
    // Reference airport for heights: the matched runway's airport, else the nearest airport within 40 km.
    const ref = r.runway?.airport ?? this.airports!.nearest(pose.lat, pose.lon, 40_000)?.airport ?? prev?.ref;
    const targetOffsetM = ref ? this.ground.offsetM(ref) : (prev?.targetOffsetM ?? 0);
    const t: TrackedPhase = {
      phase: r.phase,
      runway: r.runway,
      ref,
      aglFt: r.aglFt,
      memory: r.memory,
      targetOffsetM,
      offsetM: prev?.offsetM ?? targetOffsetM,
    };
    this.tracked.set(a.hex, t);
    if (prev?.phase !== t.phase) for (const l of this.listeners) l(a.hex, prev?.phase, t.phase, t);
    return t;
  }

  /** Render-height offset for an aircraft (blends towards the target ~30 %/s). Called every frame. */
  offsetFor(hex: string, dtS: number): number {
    const t = this.tracked.get(hex);
    if (!t) return 0;
    t.offsetM = lerp(t.offsetM, t.targetOffsetM, Math.min(1, dtS * 0.6));
    return t.offsetM;
  }
}
