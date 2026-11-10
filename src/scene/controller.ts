import { Cartesian3, Cartographic, EllipsoidTerrainProvider, ScreenSpaceEventHandler, ScreenSpaceEventType, ShadowMode, type Viewer, type Cartesian2 } from 'cesium';
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
import { Airport3DLayer } from './airport3dLayer';
import { SkyController, cartoDeg } from './sky';
import { WeatherWatcher } from './weatherWatcher';
import { ReplayController } from './replay';
import { AlertMonitor } from './alertMonitor';
import { installDataCredits, trackCreditBarHeight } from './credits';
import { QUALITY, type QualityLevel } from '../config/quality';
import { photoreal, photorealScope, quality, showLabels, terrain3d, weatherOn } from '../state/settings';
import { OpenTerrain } from './openTerrain';
import { sceneNowMs } from './sceneTime';
import { solarElevationDeg } from '../../shared/sun';
import { PhotorealScope } from './photorealScope';
import { env } from '../config/env';
import { api } from '../api';
import { baseLayerStatus, toast } from '../state/store';
import { aircraftStore, nowMs } from '../state/aircraftStore';
import { cameraMode, followHex, selectedHex } from '../state/selection';
import { canUseFeature, featureContext } from '../state/entitlements';
import { flightInfo } from '../state/flightInfo';
import { loadAirports } from '../data/airports';
import { FT_TO_M, haversineM } from '../../shared/geo';
import { focusWeather } from '../state/weather';
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
  readonly airport3d: Airport3DLayer;
  readonly scope: PhotorealScope;
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
    this.airport3d = new Airport3DLayer(this.viewer, this.ground);
    this.scope = new PhotorealScope(this.viewer, this.baseLayers, this.ground, this.airport3d);
    this.feed = new LiveFeed(this.viewer);
    this.cameras = new CameraRig(this.viewer, this.aircraft);
    this.sky = new SkyController(this.viewer, this.baseLayers);
    this.alerts = new AlertMonitor(this.phases);
    // Wind for the runway-in-use guess when no traffic has been seen yet (weather is fetched for the focus point).
    this.phases.windAt = (ap) => {
      const w = focusWeather.value?.info;
      if (!w || w.windDir === undefined || w.windKt === undefined) return undefined;
      return haversineM(w.lat, w.lon, ap.lat, ap.lon) < 40_000 ? { dir: w.windDir, kt: w.windKt } : undefined;
    };
    // Landing gear: down on the ground, retracted shortly after takeoff, lowered again below ~2000 ft on approach.
    this.aircraft.models.gearDown = (f) => {
      if (f.pose.altFt === null) return true;
      const t = this.phases.get(f.a.hex);
      if (!t?.ref) return false;
      const agl = f.height - this.ground.groundM(t.ref);
      if (t.phase === 'takeoff_roll' || t.phase === 'climb') return agl < 120;
      return (t.phase === 'approach' || t.phase === 'landing' || t.phase === 'descent') && agl < 600;
    };
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

    this.disposers.push(installDataCredits(this.viewer));
    this.disposers.push(trackCreditBarHeight(this.viewer));
    this.baseLayers.onChange((s) => {
      baseLayerStatus.value = s;
      this.ground.setLayer(s.kind);
      this.airportsLayer.setLayer(s.kind);
      this.airport3d.setLayer(s.kind);
      this.cameras.minGroundFovDeg = s.kind === 'google3d' ? 10 : 34;
      this.applyTerrain();
    });
    this.disposers.push(effect(() => (void terrain3d.value, this.applyTerrain())));

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
      if (this.aircraft.models && now - this.lastNight > 2000) {
        // Navigation lights come on at dusk where the camera is.
        this.lastNight = now;
        const c = this.viewer.camera.positionCartographic;
        const elev = solarElevationDeg((c.latitude * 180) / Math.PI, (c.longitude * 180) / Math.PI, sceneNowMs());
        this.aircraft.models.night = Math.min(1, Math.max(0, (4 - elev) / 8));
      }
      this.aircraft.update(now);
      this.airport3d.update();
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
    if (this.airport3d.shadows !== q.shadows) {
      this.airport3d.shadows = q.shadows;
      this.airport3d.rebuild();
    }
    const ts = this.baseLayers.googleTileset;
    if (ts) {
      ts.maximumScreenSpaceError = q.tilesSse;
      ts.cacheBytes = q.tilesCacheMB * 1024 * 1024;
    }
    this.sky.configure({ maxClouds: q.clouds, fog: q.fog, effects: weatherOn.value && canUseFeature('weather_effects') });
  }

  private lastNight = 0;
  private readonly openTerrain = new OpenTerrain(() => this.phases.airportIndex);
  private terrainOn = false;

  /**
   * Real 3D terrain under the satellite map (open elevation tiles, airports flattened). Needs the airport index
   * (for flattening), so it switches on once that has loaded.
   */
  private applyTerrain() {
    const want = terrain3d.value && this.baseLayers.current.kind === 'satellite' && !!this.phases.airportIndex;
    if (want === this.terrainOn) return;
    this.terrainOn = want;
    this.ground.setFlatAirports(want);
    if (want) this.viewer.scene.terrainProvider = this.openTerrain.create();
    else if (this.baseLayers.current.kind === 'satellite') this.viewer.scene.terrainProvider = new EllipsoidTerrainProvider();
    this.airport3d.rebuild();
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
      const r = t?.assigned ?? t?.runway;
      const where = r ? ` at ${r.airport.iata ?? r.airport.ident}${t?.assigned ? ` (runway ${t.assigned.end.ident})` : ''}` : '';
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
    // The runway the aircraft is landing on / departing from (lined up, or the runway in use), else the nearest match.
    const m = t?.assigned ?? t?.runway;
    const pose = aircraftStore.get(hex)?.motion.sample(nowMs());
    // 40 km covers a full ILS final (intercepts are typically 10–18 NM out).
    if (!t || !m || !pose || haversineM(pose.lat, pose.lon, m.end.lat, m.end.lon) > 40_000) return false;
    const arrival = t.assigned ? t.assigned.kind === 'arr' : t.phase === 'approach' || t.phase === 'landing' || t.phase === 'descent';
    // m.end is the landing threshold, or the end the takeoff starts from.
    const vp = mode === 'tower' ? towerViewpoint(m.airport, m.runway, m.end) : runwayViewpoint(m.airport, m.runway, m.end, arrival ? 'arrival' : 'departure');
    const groundAtVp = this.ground.groundM(m.airport, vp.elevFt);
    const position = Cartesian3.fromDegrees(vp.lon, vp.lat, groundAtVp + vp.heightAglM);
    this.cameras.groundCamera = { position, label: vp.label };
    this.preloadAirport(m.airport);
    if (mode === 'tower') {
      // Prefer the airport's real control tower (OpenStreetMap) once its 3D scenery is loaded.
      const icao = m.airport.ident;
      const useReal = () => {
        const real = this.airport3d.towerFor(icao);
        if (real && this.cameras.groundCamera?.label === vp.label) {
          this.cameras.groundCamera = { position: Cartesian3.fromDegrees(real.lon, real.lat, real.height), label: vp.label };
        }
        return !!real;
      };
      if (!useReal() && this.baseLayers.current.kind !== 'google3d') {
        this.airport3d.ensure(icao);
        const prev = this.airport3d.onLoaded;
        this.airport3d.onLoaded = (loaded) => {
          prev?.(loaded);
          if (loaded === icao) useReal();
        };
      }
      if (this.airport3d.towerFor(icao)) return true;
    }
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
      this.airport3d.setAirports(a);
      this.scope.setAirports(a);
      this.applyTerrain();
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
    // Mock mode only: ?fake3d=1 stands in a local test tileset for Google's, to exercise the photoreal code paths.
    const testTilesetUrl = env.apiMode === 'mock' && new URLSearchParams(location.search).has('fake3d') ? '/tests/fixtures/fake3d/tileset.json' : undefined;
    this.disposers.push(effect(() => this.scope.setMode(photorealScope.value)));
    await this.baseLayers.init({
      testTilesetUrl,
      allowed: !!testTilesetUrl || (!!session?.allowed && (session.mode === 'google' ? !!session.googleKey : !!ionToken)),
      googleKey: session?.mode === 'google' ? session.googleKey : undefined,
      ionToken,
      arcgisKey: env.arcgisApiKey,
      satellite: true,
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
    this.airport3d.destroy();
    this.scope.destroy();
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
