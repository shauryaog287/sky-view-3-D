import { Cartesian3, Cartographic, ScreenSpaceEventHandler, ScreenSpaceEventType, ShadowMode, type Viewer, type Cartesian2 } from 'cesium';
import { effect } from '@preact/signals';
import { createViewer } from './viewer';
import { BaseLayers } from './baseLayers';
import { AircraftLayer } from './aircraftLayer';
import { LiveFeed } from './liveFeed';
import { ModelPool } from './modelPool';
import { CameraRig } from './cameras';
import { GroundHeights } from './ground';
import { PhaseTracker } from './phaseTracker';
import { AirportLayer } from './airportLayer';
import { SkyController, cartoDeg } from './sky';
import { WeatherWatcher } from './weatherWatcher';
import { ReplayController } from './replay';
import { AlertMonitor } from './alertMonitor';
import { QUALITY, type QualityLevel } from '../config/quality';
import { photoreal, quality, showLabels, weatherOn } from '../state/settings';
import { env } from '../config/env';
import { api } from '../api';
import { baseLayerStatus, toast } from '../state/store';
import { aircraftStore, nowMs } from '../state/aircraftStore';
import { cameraMode, followHex, selectedHex } from '../state/selection';
import { canUseFeature, featureContext } from '../state/entitlements';
import { flightInfo } from '../state/flightInfo';
import { loadAirports } from '../data/airports';
import { FT_TO_M } from '../../shared/geo';
import { towerViewpoint, runwayViewpoint } from '../../shared/airportPresets';
import type { FlightPhase } from '../../shared/types';
import type { Airport } from '../../shared/airports';

/**
 * Owns the Cesium scene and every scene subsystem. One instance per page load.
 * UI code talks to the scene only through this controller and the shared signals.
 */
export class SceneController {
  readonly viewer: Viewer;
  readonly baseLayers: BaseLayers;
  readonly aircraft: AircraftLayer;
  readonly feed: LiveFeed;
  readonly cameras: CameraRig;
  readonly ground: GroundHeights;
  readonly phases: PhaseTracker;
  readonly airportsLayer: AirportLayer;
  readonly sky: SkyController;
  readonly replay: ReplayController;
  readonly alerts: AlertMonitor;
  private readonly weather: WeatherWatcher;
  private weatherTimer?: ReturnType<typeof setInterval>;
  qualityLevel: QualityLevel = 'medium';
  private readonly disposers: (() => void)[] = [];
  private handler?: ScreenSpaceEventHandler;
  private lastFrame = 0;
  private readonly suggested = new Set<string>();
  private readonly preloaded = new Set<string>();

  constructor(container: HTMLElement) {
    this.viewer = createViewer({ container });
    this.baseLayers = new BaseLayers(this.viewer);
    this.aircraft = new AircraftLayer(this.viewer, aircraftStore);
    this.aircraft.models = new ModelPool(this.viewer.scene);
    this.ground = new GroundHeights(
      this.viewer,
      () => this.baseLayers.googleTileset,
      () => [this.aircraft.billboards, this.aircraft.labels],
    );
    this.phases = new PhaseTracker(aircraftStore, this.ground);
    this.airportsLayer = new AirportLayer(this.viewer);
    this.feed = new LiveFeed(this.viewer);
    this.cameras = new CameraRig(this.viewer, this.aircraft);
    this.sky = new SkyController(this.viewer, this.baseLayers);
    this.alerts = new AlertMonitor(this.phases);
    this.replay = new ReplayController(this.viewer, aircraftStore, this.cameras, (altFt, lat, lon) => {
      const near = this.phases.airportIndex?.nearest(lat, lon, 40_000)?.airport;
      if (altFt === null) return near ? this.ground.groundM(near) : 0;
      return altFt * FT_TO_M + (near ? this.ground.offsetM(near) : 0);
    });
    this.weather = new WeatherWatcher((w) => {
      this.sky.setWeather(w);
      // METAR altimeter corrects pressure altitudes near that airport (QNH ≠ 1013.25).
      const m = w?.metar;
      const ap = m ? this.phases.airportIndex?.get(m.station) : undefined;
      if (ap && m?.altimeterHpa) this.ground.setQnh(ap.ident, m.altimeterHpa);
    });

    this.baseLayers.onChange((s) => {
      baseLayerStatus.value = s;
      this.ground.setLayer(s.kind);
      this.airportsLayer.setLayer(s.kind);
    });

    // Render height = pressure altitude + a per-airport correction (geoid + terrain model + QNH), so aircraft land on
    // the runway that is actually drawn. On the ground: the rendered airfield surface.
    let dt = 0.016;
    this.aircraft.heightFn = (a, pose) => {
      const t = this.phases.get(a.hex);
      if (pose.altFt === null) {
        if (t?.ref) return this.ground.groundM(t.ref, t.runway?.end.elevFt ?? t.ref.elevFt);
        const h = this.viewer.scene.globe.show ? this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(pose.lon, pose.lat)) : undefined;
        return h ?? 0;
      }
      const hM = pose.altFt * FT_TO_M + this.phases.offsetFor(a.hex, dt);
      // Never render an airborne aircraft below its airfield surface.
      return t?.ref ? Math.max(hM, this.ground.groundM(t.ref) + 2) : hM;
    };

    const pre = () => {
      const now = nowMs();
      dt = this.lastFrame ? Math.min(0.25, (now - this.lastFrame) / 1000) : 0.016;
      this.lastFrame = now;
      if (this.aircraft.models) this.aircraft.models.silhouettes = cameraMode.value === 'free' || cameraMode.value === 'orbit' || cameraMode.value === 'chase';
      this.aircraft.update(now);
      const focus = this.focusPoint();
      this.sky.update(now, focus);
      if (!this.cameras.update(now)) {
        // The followed aircraft disappeared from the feed (landed and stopped reporting, or out of coverage).
        followHex.value = null;
        cameraMode.value = 'free';
        this.cameras.stop();
        toast('Lost contact with the followed flight.', 'warn');
      }
    };
    this.viewer.scene.preRender.addEventListener(pre);
    this.disposers.push(() => this.viewer.scene.preRender.removeEventListener(pre));

    // Quality preset (High is Pro) and label preference.
    this.disposers.push(
      effect(() => {
        const want = quality.value;
        this.applyQuality(want === 'high' && !canUseFeature('quality_high') ? 'medium' : want);
      }),
    );
    this.disposers.push(
      effect(() => {
        this.aircraft.labelsForNearby = showLabels.value;
      }),
    );
    this.disposers.push(
      effect(() => {
        void featureContext.value;
        const q = QUALITY[this.qualityLevel];
        this.sky.configure({ maxClouds: q.clouds, fog: q.fog, effects: weatherOn.value && canUseFeature('weather_effects') });
      }),
    );

    this.disposers.push(
      effect(() => {
        this.aircraft.selected = selectedHex.value;
        this.aircraft.followed = followHex.value;
        aircraftStore.pinned.clear();
        if (selectedHex.value) aircraftStore.pinned.add(selectedHex.value);
        if (followHex.value) aircraftStore.pinned.add(followHex.value);
      }),
    );

    // Phase changes of the followed / selected flight drive tile preloading and camera suggestions.
    this.disposers.push(this.phases.onPhaseChange((hex, prev, next) => this.onPhase(hex, prev, next)));

    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => {
      const hex = this.aircraft.pick(e.position);
      if (followHex.value && hex !== followHex.value) return; // taps while following do not change selection
      selectedHex.value = hex ?? (followHex.value ? selectedHex.value : null);
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  /** Where weather and clouds matter: the followed (else selected) aircraft, or a low camera's ground point. */
  private focusPoint(): { lat: number; lon: number; key: string } | undefined {
    const hex = followHex.value ?? selectedHex.value;
    const f = this.aircraft.frameOf(hex);
    if (f) {
      const t = this.phases.get(f.a.hex);
      this.sky.groundM = t?.ref ? this.ground.groundM(t.ref) : 0;
      return { lat: f.pose.lat, lon: f.pose.lon, key: f.a.hex };
    }
    const cam = this.viewer.camera.positionCartographic;
    if (cam.height < 40_000) {
      this.sky.groundM = 0;
      return { ...cartoDeg(cam), key: 'camera' };
    }
    return undefined;
  }

  applyQuality(level: QualityLevel) {
    this.qualityLevel = level;
    const q = QUALITY[level];
    const v = this.viewer;
    const dpr = window.devicePixelRatio || 1;
    v.useBrowserRecommendedResolution = false;
    v.resolutionScale = (Math.min(dpr, q.maxPixelRatio) / dpr) * q.resolutionScale;
    v.scene.globe.maximumScreenSpaceError = q.globeSse;
    v.scene.postProcessStages.fxaa.enabled = q.fxaa;
    v.targetFrameRate = q.targetFps;
    v.shadows = q.shadows;
    v.terrainShadows = q.shadows ? ShadowMode.RECEIVE_ONLY : ShadowMode.DISABLED;
    if (this.aircraft.models) {
      this.aircraft.models.maxModels = q.maxModels;
      this.aircraft.models.maxDistance = q.modelDistanceM;
      this.aircraft.models.shadows = q.shadows;
    }
    const ts = this.baseLayers.googleTileset;
    if (ts) {
      ts.maximumScreenSpaceError = q.tilesSse;
      ts.cacheBytes = q.tilesCacheMB * 1024 * 1024;
    }
    this.sky.configure({ maxClouds: q.clouds, fog: q.fog, effects: weatherOn.value && canUseFeature('weather_effects') });
  }

  private onPhase(hex: string, _prev: FlightPhase | undefined, next: FlightPhase) {
    const watched = hex === followHex.value || hex === selectedHex.value;
    if (!watched) return;
    const a = aircraftStore.get(hex);
    const t = this.phases.get(hex);
    if (next === 'descent' || next === 'approach') {
      // Pre-load the destination airport's tiles: route destination if known, else the runway we are lined up with.
      const info = flightInfo.value[hex];
      const destIcao = typeof info === 'object' ? info.destination?.icao : undefined;
      const dest = this.phases.airportIndex?.get(destIcao) ?? t?.runway?.airport;
      if (dest) this.preloadAirport(dest);
    }
    if ((next === 'approach' || next === 'takeoff_roll') && hex === followHex.value && !this.suggested.has(`${hex}:${next}`)) {
      this.suggested.add(`${hex}:${next}`);
      const where = t?.runway ? ` at ${t.runway.airport.iata ?? t.runway.airport.ident}` : '';
      const label = a?.state.callsign ?? hex.toUpperCase();
      toast(
        next === 'approach'
          ? `${label} is on approach${where} — try the Tower or Runway camera.`
          : `${label} is rolling for takeoff${where} — try the Runway camera.`,
        'info',
        6000,
      );
    }
  }

  private preloadAirport(airport: Airport) {
    if (this.preloaded.has(airport.ident)) return;
    this.preloaded.add(airport.ident);
    void this.ground.preload(airport);
  }

  /** Set up the tower / runway-end camera for an aircraft near an airport. Returns false if none applies. */
  prepareGroundCamera(hex: string, mode: 'tower' | 'runway'): boolean {
    this.phases.tick();
    const t = this.phases.get(hex);
    const m = t?.runway;
    if (!t || !m || m.distToEndM > 25_000) return false;
    const arrival = t.phase === 'approach' || t.phase === 'landing' || t.phase === 'descent';
    // m.end is the runway end aligned with the aircraft's track: the landing threshold, or the end it departs from.
    const vp = mode === 'tower' ? towerViewpoint(m.airport, m.runway, m.end) : runwayViewpoint(m.airport, m.runway, m.end, arrival ? 'arrival' : 'departure');
    const groundAtVp = this.ground.groundM(m.airport, vp.elevFt);
    const position = Cartesian3.fromDegrees(vp.lon, vp.lat, groundAtVp + vp.heightAglM);
    this.cameras.groundCamera = { position, label: vp.label };
    this.preloadAirport(m.airport);
    // Lift the camera above any building the photoreal tiles have at that spot.
    void this.ground.sampleAt(vp.lat, vp.lon).then((h) => {
      if (h !== undefined && h + 3 > groundAtVp + vp.heightAglM && this.cameras.groundCamera?.label === vp.label) {
        this.cameras.groundCamera = { position: Cartesian3.fromDegrees(vp.lon, vp.lat, h + 12), label: vp.label };
      }
    });
    return true;
  }

  async start() {
    this.feed.start();
    this.phases.start();
    this.alerts.start();
    void loadAirports().then((a) => {
      this.phases.setAirports(a);
      this.airportsLayer.setAirports(a);
    });
    this.weatherTimer = setInterval(() => {
      void this.weather.check(this.focusPoint(), weatherOn.value && canUseFeature('weather_effects'));
    }, 4000);
    await this.initTiles();
    this.applyQuality(this.qualityLevel);
  }

  private photorealAttempted = false;

  /** One tiles session per page load (one billable Google root request at most). */
  private async initTiles() {
    const wantPhotoreal = photoreal.value && canUseFeature('airport_views');
    this.photorealAttempted = wantPhotoreal;
    const session = wantPhotoreal ? await api.tilesSession().catch(() => undefined) : undefined;
    const ionToken = env.cesiumIonToken ?? session?.ionToken;
    await this.baseLayers.init({
      allowed: !!session?.allowed && (session.mode === 'google' ? !!session.googleKey : !!ionToken),
      googleKey: session?.mode === 'google' ? session.googleKey : undefined,
      ionToken,
      deniedReason: !wantPhotoreal
        ? canUseFeature('airport_views')
          ? 'Photorealistic 3D turned off in settings'
          : 'Photorealistic 3D is a Pro feature'
        : (session?.reason ?? 'Photorealistic tiles unavailable'),
      cacheBytes: QUALITY[this.qualityLevel].tilesCacheMB * 1024 * 1024,
      maximumScreenSpaceError: QUALITY[this.qualityLevel].tilesSse,
    });
    // If the user upgrades mid-session (freemium), switch to photoreal without reloading.
    this.disposers.push(
      effect(() => {
        void featureContext.value;
        if (!this.photorealAttempted && canUseFeature('airport_views') && photoreal.value) void this.upgradeTiles();
      }),
    );
  }

  private async upgradeTiles() {
    this.photorealAttempted = true;
    const session = await api.tilesSession().catch(() => undefined);
    if (!session?.allowed) return;
    await this.baseLayers.tryGoogle({
      allowed: true,
      googleKey: session.mode === 'google' ? session.googleKey : undefined,
      ionToken: env.cesiumIonToken ?? session.ionToken,
    });
  }

  destroy() {
    this.feed.stop();
    this.phases.stop();
    clearInterval(this.weatherTimer);
    this.sky.destroy();
    this.replay.destroy();
    this.alerts.stop();
    this.handler?.destroy();
    for (const d of this.disposers) d();
    this.airportsLayer.destroy();
    this.aircraft.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}

let current: SceneController | null = null;
export function getScene(): SceneController | null {
  return current;
}
export function setScene(s: SceneController | null) {
  current = s;
  if (env.isDev || env.apiMode === 'mock') {
    (window as unknown as { __skyview?: unknown }).__skyview = { scene: s, store: aircraftStore };
  }
}
