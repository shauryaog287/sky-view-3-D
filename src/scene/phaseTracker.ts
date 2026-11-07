import { detectPhase, type PhaseMemory } from '../../shared/phase';
import type { RunwayMatch, AirportIndex, Airport } from '../../shared/airports';
import type { FlightPhase } from '../../shared/types';
import { haversineM, lerp } from '../../shared/geo';
import { RunwayUsage, type RunwayAssignment } from '../../shared/runwayUsage';
import type { AircraftStore, LiveAircraft } from '../state/aircraftStore';
import { flightPhases, flightRunways, type RunwayLabel } from '../state/phases';
import type { GroundHeights } from './ground';
import { nowMs } from '../state/aircraftStore';

export interface TrackedPhase {
  phase: FlightPhase;
  /** Best geometric runway match (whatever runway the aircraft is closest to being aligned with). */
  runway?: RunwayMatch;
  /** The runway this aircraft is landing on / departing from (see shared/runwayUsage.ts). */
  assigned?: RunwayAssignment;
  /** When it last touched down (so a taxi-in is not mistaken for a departure). */
  landedAt?: number;
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
  /** Runway-in-use model, learned from every aircraft's landings and takeoffs. */
  readonly usage = new RunwayUsage();
  /** Surface wind at an airport, when known (from the weather layer). */
  windAt?: (airport: Airport) => { dir: number; kt: number } | undefined;

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
    const runways: Record<string, RunwayLabel> = {};
    let runwaysChanged = false;
    for (const a of this.store.map.values()) {
      const t = this.evaluate(a, now);
      if (t && flightPhases.value[a.hex] !== t.phase) {
        changed[a.hex] = t.phase;
        any = true;
      }
      const label = t?.assigned && runwayLabel(t.assigned);
      if (label) runways[a.hex] = label;
      const old = flightRunways.value[a.hex];
      if (old?.ident !== label?.ident || old?.airport !== label?.airport || old?.source !== label?.source) runwaysChanged = true;
    }
    if (runwaysChanged || Object.keys(flightRunways.value).length !== Object.keys(runways).length) flightRunways.value = runways;
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
      landedAt: prev?.landedAt,
    };
    if (prev?.phase === 'landing' && r.phase === 'ground') t.landedAt = now;
    t.assigned = this.assignRunway(a.hex, t, prev, { lat: pose.lat, lon: pose.lon }, now);
    this.tracked.set(a.hex, t);
    if (prev?.phase !== t.phase) for (const l of this.listeners) l(a.hex, prev?.phase, t.phase, t);
    return t;
  }

  /**
   * Record what the aircraft is doing on a runway (feeds the runway-in-use model) and decide which runway it uses:
   * aligned on final / rolling → that runway; descending towards an airport → the arrival runway in use; taxiing out
   * → the departure runway in use; climbing out → keep the runway it took off from.
   */
  private assignRunway(hex: string, t: TrackedPhase, prev: TrackedPhase | undefined, pos: { lat: number; lon: number }, now: number): RunwayAssignment | undefined {
    const m = t.runway;
    const fromMatch = (kind: 'arr' | 'dep'): RunwayAssignment | undefined =>
      m && { airport: m.airport, runway: m.runway, end: m.end, far: m.far, kind, source: 'aligned' };
    const established = !!m && m.headingDiff < 15 && Math.abs(m.crossM) < 600 && m.alongM > -20_000;
    if ((t.phase === 'approach' || t.phase === 'landing') && established) {
      if (t.phase === 'landing' || m!.alongM > -10_000) this.usage.record(m!.airport, hex, m!.end, 'arr', now);
      return fromMatch('arr');
    }
    if (t.phase === 'takeoff_roll' && m?.onRunway) {
      this.usage.record(m.airport, hex, m.end, 'dep', now);
      return fromMatch('dep');
    }
    if (t.phase === 'climb' && prev?.assigned?.kind === 'dep' && (t.aglFt ?? 0) < 4000) return prev.assigned;
    if (t.phase === 'ground' && prev?.assigned?.kind === 'arr' && prev.assigned.source === 'aligned' && t.landedAt && now - t.landedAt < 120_000) return prev.assigned;
    const ref = t.ref;
    if (!ref || ref.kind === 'S' || !ref.runways.length) return undefined;
    const near = haversineM(pos.lat, pos.lon, ref.lat, ref.lon);
    const wind = this.windAt?.(ref);
    if ((t.phase === 'descent' || t.phase === 'approach') && near < 60_000) return this.usage.assign(ref, 'arr', now, { wind, from: pos });
    if (t.phase === 'ground' && near < 6_000 && (!t.landedAt || now - t.landedAt > 20 * 60_000)) return this.usage.assign(ref, 'dep', now, { wind, from: pos });
    return undefined;
  }

  /** Render-height offset for an aircraft (blends towards the target ~30 %/s). Called every frame. */
  offsetFor(hex: string, dtS: number): number {
    const t = this.tracked.get(hex);
    if (!t) return 0;
    t.offsetM = lerp(t.offsetM, t.targetOffsetM, Math.min(1, dtS * 0.6));
    return t.offsetM;
  }
}

function runwayLabel(a: RunwayAssignment): RunwayLabel {
  return { ident: a.end.ident, airport: a.airport.iata ?? a.airport.ident, kind: a.kind, source: a.source };
}
