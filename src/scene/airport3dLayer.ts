import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CornerType,
  CorridorGeometry,
  Credit,
  GeometryInstance,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  type Viewer,
} from 'cesium';
import { toLatLon, type Airport3D } from '../../shared/airport3d';
import { buildAirportMesh } from '../../shared/airportMesh';
import { airfieldLighting, apronMasts } from '../../shared/airportLights';
import type { Airport, AirportIndex } from '../../shared/airports';
import { solarElevationDeg } from '../../shared/sun';
import type { BaseLayerKind } from './baseLayers';
import type { GroundHeights } from './ground';
import { createAirportPrimitive } from './airportAppearance';
import { AirfieldLightSet } from './airfieldLights';
import { sceneNowMs } from './sceneTime';
import { env } from '../config/env';

const APRON = Color.fromCssColorString('#8e9296');
const TAXIWAY = Color.fromCssColorString('#4b4f55');

/** Airports are built when the camera is within this range, and dropped beyond the second one. */
const LOAD_M = 32_000;
const UNLOAD_M = 60_000;
const MAX_CAMERA_HEIGHT_M = 22_000;

interface Loaded {
  data: Airport3D | null;
  airport: Airport;
  prims: Primitive[];
  lights?: AirfieldLightSet;
  base: number;
}

/**
 * Airports in 3D from OpenStreetMap (shared/airportMesh.ts): glazed terminals, buildings with windows, hangars,
 * control towers, jet bridges, tanks and masts, standing on the satellite imagery (or on drawn aprons/taxiways on the
 * offline globe) — plus the airfield lighting (shared/airportLights.ts), which is also drawn for airports without
 * any building data. With Google Photorealistic 3D Tiles the buildings come from Google, so only the lights are added.
 *
 * Pre-built airports ship as static files (public/airports3d); any other airport is fetched from /api/airport3d.
 */
export class Airport3DLayer {
  private readonly loaded = new Map<string, Loaded>();
  private readonly loading = new Set<string>();
  /** Scenery data per airport (fetched once, also in photoreal mode where it only outlines the airport). */
  private readonly data = new Map<string, Promise<Airport3D | null>>();
  private layer: BaseLayerKind = 'offline';
  private airports?: AirportIndex;
  private readonly credit = new Credit('Airport buildings © OpenStreetMap contributors (ODbL)', true);
  private creditShown = false;
  private timer?: ReturnType<typeof setInterval>;
  private lastNightCheck = 0;
  /** Buildings cast shadows (set from the quality preset). */
  shadows = false;
  /** Airfield lighting on/off (quality preset / setting). */
  lightsEnabled = true;
  onLoaded?: (icao: string) => void;

  constructor(
    private readonly viewer: Viewer,
    private readonly ground: GroundHeights,
  ) {
    viewer.camera.moveEnd.addEventListener(this.refresh);
    // Follow cameras move continuously without moveEnd: re-check every few seconds.
    this.timer = setInterval(this.refresh, 3000);
  }

  setAirports(a: AirportIndex) {
    this.airports = a;
    this.refresh();
  }

  setLayer(kind: BaseLayerKind) {
    if (kind === this.layer) return;
    this.layer = kind;
    this.rebuild();
  }

  /** Drop everything built so far and rebuild (the ground level or a setting changed). */
  rebuild() {
    for (const icao of [...this.loaded.keys()]) this.unload(icao);
    this.refresh();
  }

  /** The main ATC tower of an airport, if its scenery is loaded (eye position for the tower camera). */
  towerFor(icao: string): { lat: number; lon: number; height: number } | undefined {
    const l = this.loaded.get(icao);
    const t = l?.data?.towers[0];
    if (!l || !l.data || !t) return undefined;
    const p = toLatLon(l.data.origin, t.x, t.y);
    return { lat: p.lat, lon: p.lon, height: l.base + t.h };
  }

  /** Make sure an airport's scenery is loading (e.g. when a ground camera is opened there). */
  ensure(icao: string) {
    const ap = this.airports?.get(icao);
    if (ap) void this.load(ap);
  }

  readonly refresh = () => {
    if (!this.airports) return;
    const cam = this.viewer.camera.positionCartographic;
    const lat = CesiumMath.toDegrees(cam.latitude);
    const lon = CesiumMath.toDegrees(cam.longitude);
    if (cam.height < MAX_CAMERA_HEIGHT_M) {
      const near = this.airports.within(lat, lon, LOAD_M).filter((x) => x.airport.kind !== 'S' || x.distM < 8000).slice(0, 4);
      for (const { airport } of near) void this.load(airport);
    }
    for (const [icao, l] of this.loaded) {
      const d = Math.hypot((l.airport.lat - lat) * 111_000, (l.airport.lon - lon) * 111_000 * Math.cos((lat * Math.PI) / 180));
      if (d > UNLOAD_M) this.unload(icao);
    }
  };

  /** Per frame: flashing and direction-dependent lights. */
  update() {
    if (!this.loaded.size) return;
    const now = sceneNowMs();
    const cam = this.viewer.camera.positionWC;
    const checkNight = now - this.lastNightCheck > 5000 || now < this.lastNightCheck;
    if (checkNight) this.lastNightCheck = now;
    for (const l of this.loaded.values()) {
      if (!l.lights) continue;
      // Lights come on at dusk (sun under 4°) and go off after sunrise.
      if (checkNight) l.lights.setNight(solarElevationDeg(l.airport.lat, l.airport.lon, now) < 4);
      l.lights.update(now / 1000, cam);
    }
  }

  /** Scenery data for an airport (static file or on-demand API), or null if there is none. Cached. */
  dataFor(icao: string): Promise<Airport3D | null> {
    let p = this.data.get(icao);
    if (!p) {
      p = this.fetchData(icao);
      this.data.set(icao, p);
      // Network errors should not stick forever.
      void p.then((d) => !d && setTimeout(() => this.data.get(icao) === p && this.data.delete(icao), 10 * 60_000));
    }
    return p;
  }

  private async fetchData(icao: string): Promise<Airport3D | null> {
    try {
      const res = await fetch(`/airports3d/${icao}.json`);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return (await res.json()) as Airport3D;
    } catch {
      /* fall through */
    }
    if (env.apiMode !== 'http') return null;
    try {
      const res = await fetch(`${env.apiBase}/api/airport3d/${icao}`);
      return res.ok ? ((await res.json()) as Airport3D) : null;
    } catch {
      return null;
    }
  }

  private async load(airport: Airport) {
    const icao = airport.ident;
    if (this.loaded.has(icao) || this.loading.has(icao)) return;
    this.loading.add(icao);
    try {
      const layer = this.layer;
      const raw = await this.dataFor(icao);
      const data = raw && Array.isArray(raw.buildings) ? raw : null;
      await this.ground.preload(airport);
      if (this.loaded.has(icao) || this.layer !== layer) return;
      const base = this.ground.groundM(airport);
      const prims: Primitive[] = [];
      let tops: { x: number; y: number; z: number }[] = [];
      if (data && layer !== 'google3d') {
        const mesh = buildAirportMesh({ ...data, masts: [...(data.masts ?? []), ...apronMasts(data)] });
        tops = mesh.tops;
        const p = createAirportPrimitive(mesh, data.origin, base, this.shadows);
        if (p) prims.push(this.viewer.scene.primitives.add(p) as Primitive);
        if (layer === 'offline') prims.push(...this.pavement(data, base));
      }
      let lights: AirfieldLightSet | undefined;
      if (this.lightsEnabled && airport.runways.length) {
        const layout = airfieldLighting(airport, data, tops);
        if (layout.lights.length) lights = new AirfieldLightSet(this.viewer.scene, layout, data?.origin ?? [airport.lat, airport.lon], base);
      }
      this.loaded.set(icao, { data, airport, base, prims, lights });
      this.lastNightCheck = 0;
      this.updateCredit();
      this.onLoaded?.(icao);
    } finally {
      this.loading.delete(icao);
    }
  }

  private unload(icao: string) {
    const l = this.loaded.get(icao);
    if (!l) return;
    for (const p of l.prims) this.viewer.scene.primitives.remove(p);
    l.lights?.destroy();
    this.loaded.delete(icao);
    this.updateCredit();
  }

  private updateCredit() {
    const want = [...this.loaded.values()].some((l) => l.data);
    if (want && !this.creditShown) this.viewer.creditDisplay.addStaticCredit(this.credit);
    if (!want && this.creditShown) this.viewer.creditDisplay.removeStaticCredit(this.credit);
    this.creditShown = want;
  }

  /** Without imagery (offline globe) draw the paved areas too; with imagery the real ones are visible. */
  private pavement(a: Airport3D, base: number): Primitive[] {
    const pos = (ring: number[]) => {
      const out: Cartesian3[] = [];
      for (let i = 0; i < ring.length; i += 2) {
        const p = toLatLon(a.origin, ring[i], ring[i + 1]);
        out.push(Cartesian3.fromDegrees(p.lon, p.lat, 0));
      }
      return out;
    };
    const color = (c: Color) => ({ color: ColorGeometryInstanceAttribute.fromColor(c) });
    const flat: GeometryInstance[] = [];
    for (const ring of a.aprons) {
      if (ring.length < 6) continue;
      flat.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(pos(ring)), height: base + 0.3, vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
          attributes: color(APRON),
        }),
      );
    }
    for (const t of a.taxiways) {
      if (t.line.length < 4) continue;
      flat.push(
        new GeometryInstance({
          geometry: new CorridorGeometry({ positions: pos(t.line), width: t.w, height: base + 0.6, cornerType: CornerType.ROUNDED, vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
          attributes: color(TAXIWAY),
        }),
      );
    }
    if (!flat.length) return [];
    return [
      this.viewer.scene.primitives.add(
        new Primitive({ geometryInstances: flat, appearance: new PerInstanceColorAppearance({ flat: true }), asynchronous: true, releaseGeometryInstances: true }),
      ) as Primitive,
    ];
  }

  destroy() {
    clearInterval(this.timer);
    this.viewer.camera.moveEnd.removeEventListener(this.refresh);
    for (const icao of [...this.loaded.keys()]) this.unload(icao);
  }
}
