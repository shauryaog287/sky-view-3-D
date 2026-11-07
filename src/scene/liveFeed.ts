import { Cartographic, Math as CesiumMath, Rectangle, type Viewer } from 'cesium';
import { signal } from '@preact/signals';
import type { BBox } from '../../shared/geo';
import { clamp, wrapLon } from '../../shared/geo';
import type { ProviderStatus, RegionNotice } from '../../shared/types';
import { api, ApiError } from '../api';
import { aircraftStore, nowMs } from '../state/aircraftStore';

export interface FeedStatus {
  state: 'idle' | 'loading' | 'ok' | 'error';
  count: number;
  notice?: RegionNotice | 'offline' | 'no_aircraft';
  error?: string;
  truncated: boolean;
  stale: boolean;
  providers: ProviderStatus[];
  lastOk?: number;
}

export const feedStatus = signal<FeedStatus>({ state: 'idle', count: 0, truncated: false, stale: false, providers: [] });

/**
 * Polls /api/aircraft for whatever the camera is looking at. 3 s cadence when zoomed in, 6 s when zoomed out,
 * paused while the tab is hidden, exponential backoff on errors. Positions are smoothed by MotionTrack.
 */
export class LiveFeed {
  private timer?: ReturnType<typeof setTimeout>;
  private inflight?: AbortController;
  private failures = 0;
  private stopped = false;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') this.kick();
  };

  constructor(
    private readonly viewer: Viewer,
    private readonly extraView?: () => BBox | undefined,
  ) {}

  start() {
    document.addEventListener('visibilitychange', this.onVisibility);
    this.viewer.camera.moveEnd.addEventListener(this.kick);
    this.kick();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.inflight?.abort();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.viewer.camera.moveEnd.removeEventListener(this.kick);
  }

  /** Poll now (e.g. after the camera stops moving). */
  readonly kick = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), 50);
  };

  private schedule(ms: number) {
    clearTimeout(this.timer);
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), ms);
  }

  private cameraHeight(): number {
    return this.viewer.camera.positionCartographic.height;
  }

  /** The area to poll: the visible rectangle, or a circle around the camera when it is low or looking at the sky. */
  viewBBox(): BBox {
    const cam = this.viewer.camera;
    const h = this.cameraHeight();
    const rect = h > 60_000 ? cam.computeViewRectangle(this.viewer.scene.globe.ellipsoid, new Rectangle()) : undefined;
    if (rect) {
      return {
        minLat: CesiumMath.toDegrees(rect.south),
        maxLat: CesiumMath.toDegrees(rect.north),
        minLon: CesiumMath.toDegrees(rect.west),
        maxLon: CesiumMath.toDegrees(rect.east),
      };
    }
    // Near the ground: a radius around the point the camera is over (enough to see approaching traffic).
    const c = Cartographic.clone(cam.positionCartographic);
    const radiusKm = clamp((h / 1000) * 2 + 40, 40, 400);
    const dLat = radiusKm / 111;
    const dLon = dLat / Math.max(0.1, Math.cos(c.latitude));
    const lat = CesiumMath.toDegrees(c.latitude);
    const lon = CesiumMath.toDegrees(c.longitude);
    return { minLat: clamp(lat - dLat, -89, 89), maxLat: clamp(lat + dLat, -89, 89), minLon: wrapLon(lon - dLon), maxLon: wrapLon(lon + dLon) };
  }

  private async tick() {
    if (this.stopped) return;
    if (document.visibilityState === 'hidden') return; // resumes on visibilitychange
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    const zoomedIn = this.cameraHeight() < 400_000;
    const started = nowMs();
    if (feedStatus.value.state === 'idle') feedStatus.value = { ...feedStatus.value, state: 'loading' };
    try {
      const views = [this.viewBBox(), this.extraView?.()].filter((b): b is BBox => !!b);
      const results = await Promise.all(views.map((v) => api.region(v, ctrl.signal)));
      if (ctrl.signal.aborted) return;
      const now = nowMs();
      const first = results[0];
      aircraftStore.noteServerTime(first.now + (now - started) / 2, now);
      for (const r of results) aircraftStore.ingest(r.aircraft, now);
      aircraftStore.prune(now);
      this.failures = 0;
      const count = first.aircraft.length;
      feedStatus.value = {
        state: 'ok',
        count,
        truncated: first.truncated,
        stale: first.stale,
        providers: first.providers,
        notice: first.notice ?? (count === 0 ? 'no_aircraft' : undefined),
        lastOk: now,
      };
      this.schedule(zoomedIn ? 3000 : 6000);
    } catch (e) {
      if (ctrl.signal.aborted && !(e instanceof ApiError && e.code === 'timeout')) return;
      this.failures++;
      const err = e instanceof ApiError ? e : undefined;
      feedStatus.value = {
        ...feedStatus.value,
        state: 'error',
        error: err?.message ?? 'Could not load flights',
        notice: !navigator.onLine ? 'offline' : 'providers_down',
      };
      this.schedule(Math.min(30_000, 2000 * 2 ** Math.min(4, this.failures - 1)));
    }
  }
}
