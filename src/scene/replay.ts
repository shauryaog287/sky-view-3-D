import { modelIdFor } from '../../shared/aircraftModels';
import { ArcType, Color, Material, PolylineCollection, Cartesian3, type Polyline, type Viewer } from 'cesium';
import { effect } from '@preact/signals';
import { HermiteTrack } from '../motion/hermite';
import { MotionTrack, type Pose } from '../motion/smoother';
import type { AircraftStore, LiveAircraft } from '../state/aircraftStore';
import { nowMs } from '../state/aircraftStore';
import { replay, replayClock, closeReplay } from '../state/replay';
import { cameraMode, followHex, selectedHex } from '../state/selection';
import type { CameraRig } from './cameras';
import { api } from '../api';
import { FT_TO_M } from '../../shared/geo';

export const REPLAY_PREFIX = 'replay:';

/** A MotionTrack whose poses come from a recorded track at the replay clock instead of live fixes. */
class ReplayMotion extends MotionTrack {
  constructor(
    readonly track: HermiteTrack,
    private readonly clock: () => number,
  ) {
    super();
  }
  override sample(): Pose {
    return this.track.pose(this.clock());
  }
  override get lastFixTime(): number {
    return nowMs();
  }
}

/**
 * Replays the last ~60 minutes of a flight from our stored track points (D1). The replayed aircraft is injected into
 * the aircraft store as a pinned pseudo-aircraft, so it gets the same models, heights, phases and cameras as live ones.
 */
export class ReplayController {
  private line?: Polyline;
  private readonly lines: PolylineCollection;
  private entryHex?: string;
  private wall0 = 0;
  private t0 = 0;
  private prevSelected: string | null = null;
  private readonly dispose: () => void;

  constructor(
    private readonly viewer: Viewer,
    private readonly store: AircraftStore,
    private readonly cameras: CameraRig,
    private readonly heightOf: (altFt: number | null, lat: number, lon: number) => number,
  ) {
    this.lines = viewer.scene.primitives.add(new PolylineCollection());
    this.dispose = effect(() => {
      const r = replay.value;
      if (r?.status === 'loading' && r.hex !== this.loadingHex) void this.load(r.hex);
      if (!r && this.entryHex) this.teardown();
    });
  }

  private loadingHex?: string;

  private async load(hex: string) {
    this.loadingHex = hex;
    this.teardown();
    this.prevSelected = selectedHex.value;
    try {
      const pts = await api.track(hex, 60);
      if (replay.value?.hex !== hex) return;
      if (pts.length < 2) {
        replay.value = { hex, status: 'empty' };
        return;
      }
      const track = new HermiteTrack(pts);
      const live = this.store.get(hex);
      const id = REPLAY_PREFIX + hex;
      this.wall0 = nowMs();
      this.t0 = track.start;
      replayClock.value = { t: track.start, playing: true, speed: replayClock.value.speed || 8 };
      const motion = new ReplayMotion(track, () => this.clock());
      const entry: LiveAircraft = {
        hex: id,
        state: { ...(live?.state ?? { lat: pts[0].lat, lon: pts[0].lon, onGround: false, posTs: pts[0].ts, seenTs: pts[0].ts, source: 'fixture' }), hex: id },
        motion,
        modelClass: live?.modelClass ?? 'generic',
        modelId: live?.modelId ?? modelIdFor(undefined, 'generic'),
        lastUpdate: Number.MAX_SAFE_INTEGER / 2,
        firstSeen: nowMs(),
      };
      this.store.map.set(id, entry);
      this.store.pinned.add(id);
      this.store.version.value++;
      this.entryHex = id;
      this.drawPath(track);
      replay.value = { hex, status: 'ready', start: track.start, end: track.end, points: pts.length };
      selectedHex.value = null;
      // Let the aircraft layer create the visual, then chase it.
      requestAnimationFrame(() => {
        followHex.value = id;
        cameraMode.value = 'chase';
        this.cameras.follow(id, 'chase', nowMs());
      });
    } catch (e) {
      if (replay.value?.hex === hex) replay.value = { hex, status: 'error', error: (e as Error).message };
    } finally {
      this.loadingHex = undefined;
    }
  }

  /** Replay time (epoch ms of the recording) at this instant. */
  clock(): number {
    const c = replayClock.value;
    const r = replay.value;
    if (!c.playing || !r?.end) return c.t;
    const t = this.t0 + (nowMs() - this.wall0) * c.speed;
    if (t >= r.end) {
      replayClock.value = { ...c, t: r.end, playing: false };
      return r.end;
    }
    return t;
  }

  /** Called by the UI: seek / play / pause / change speed. */
  control(patch: Partial<{ t: number; playing: boolean; speed: number }>) {
    const cur = { ...replayClock.value, t: this.clock() };
    const next = { ...cur, ...patch };
    if (patch.playing && replay.value?.end && cur.t >= replay.value.end && patch.t === undefined) next.t = replay.value.start ?? cur.t;
    this.t0 = next.t;
    this.wall0 = nowMs();
    replayClock.value = next;
  }

  private drawPath(track: HermiteTrack) {
    const positions: Cartesian3[] = [];
    const step = Math.max(5000, (track.end - track.start) / 600);
    for (let t = track.start; t <= track.end; t += step) {
      const p = track.at(t);
      positions.push(Cartesian3.fromDegrees(p.lon, p.lat, this.heightOf(p.altM === null ? null : p.altM / FT_TO_M, p.lat, p.lon)));
    }
    this.line = this.lines.add({
      positions,
      width: 3,
      arcType: ArcType.NONE,
      material: Material.fromType('Color', { color: Color.fromCssColorString('#e07bff').withAlpha(0.9) }),
    });
  }

  private teardown() {
    if (this.line) {
      this.lines.remove(this.line);
      this.line = undefined;
    }
    if (this.entryHex) {
      const id = this.entryHex;
      this.entryHex = undefined;
      if (followHex.value === id) {
        followHex.value = null;
        cameraMode.value = 'free';
        this.cameras.stop();
      }
      this.store.map.delete(id);
      this.store.pinned.delete(id);
      this.store.version.value++;
      if (this.prevSelected) selectedHex.value = this.prevSelected;
    }
  }

  exit() {
    closeReplay();
  }

  destroy() {
    this.dispose();
    this.teardown();
    this.viewer.scene.primitives.remove(this.lines);
  }
}
