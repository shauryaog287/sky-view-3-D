import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CornerType,
  CorridorGeometry,
  Credit,
  CylinderGeometry,
  GeometryInstance,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  Transforms,
  type Viewer,
} from 'cesium';
import { toLatLon, type Airport3D, type BuildingKind } from '../../shared/airport3d';
import type { Airport, AirportIndex } from '../../shared/airports';
import type { BaseLayerKind } from './baseLayers';
import type { GroundHeights } from './ground';
import { env } from '../config/env';

const COLORS: Record<BuildingKind, Color> = {
  terminal: Color.fromCssColorString('#cfd8e2'),
  hangar: Color.fromCssColorString('#bcc1c7'),
  building: Color.fromCssColorString('#c9bfb2'),
  roof: Color.fromCssColorString('#e3e4e2'),
  parking: Color.fromCssColorString('#9a9da2'),
  tower: Color.fromCssColorString('#dcdad4'),
};
const BRIDGE = Color.fromCssColorString('#9ea6ae');
const GLASS = Color.fromCssColorString('#3c5a74');
const APRON = Color.fromCssColorString('#8e9296');
const TAXIWAY = Color.fromCssColorString('#4b4f55');

interface Loaded {
  data: Airport3D;
  airport: Airport;
  prims: Primitive[];
  base: number;
  kind: BaseLayerKind;
}

/**
 * 3D airport scenery from OpenStreetMap: terminals, hangars, control towers and jet bridges standing on the
 * satellite imagery (or on drawn aprons/taxiways on the offline globe). Not used with Google Photorealistic 3D Tiles,
 * which already contain the real buildings.
 *
 * Curated airports ship as static files (public/airports3d); any other airport is fetched from /api/airport3d.
 */
export class Airport3DLayer {
  private readonly loaded = new Map<string, Loaded>();
  private readonly pending = new Map<string, Promise<Airport3D | null>>();
  private readonly missing = new Set<string>();
  private layer: BaseLayerKind = 'offline';
  private airports?: AirportIndex;
  private readonly credit = new Credit('Airport buildings © OpenStreetMap contributors (ODbL)', true);
  private creditShown = false;
  private timer?: ReturnType<typeof setInterval>;
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
    for (const icao of [...this.loaded.keys()]) this.unload(icao);
    this.refresh();
  }

  /** The main ATC tower of an airport, if its scenery is loaded (eye position for the tower camera). */
  towerFor(icao: string): { lat: number; lon: number; height: number } | undefined {
    const l = this.loaded.get(icao);
    const t = l?.data.towers[0];
    if (!l || !t) return undefined;
    const p = toLatLon(l.data.origin, t.x, t.y);
    return { lat: p.lat, lon: p.lon, height: l.base + t.h };
  }

  /** Make sure an airport's scenery is loading (e.g. when a ground camera is opened there). */
  ensure(icao: string) {
    const ap = this.airports?.get(icao);
    if (ap) void this.load(ap);
  }

  readonly refresh = () => {
    if (!this.airports || this.layer === 'google3d') return;
    const cam = this.viewer.camera.positionCartographic;
    if (cam.height > 15_000) return;
    const lat = CesiumMath.toDegrees(cam.latitude);
    const lon = CesiumMath.toDegrees(cam.longitude);
    const near = this.airports.within(lat, lon, 18_000).filter((x) => x.airport.kind !== 'S').slice(0, 2);
    for (const { airport } of near) void this.load(airport);
    for (const [icao, l] of this.loaded) {
      const d = Math.hypot((l.airport.lat - lat) * 111_000, (l.airport.lon - lon) * 111_000 * Math.cos((lat * Math.PI) / 180));
      if (d > 45_000) this.unload(icao);
    }
  };

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
    if (this.loaded.has(icao) || this.missing.has(icao)) return;
    let p = this.pending.get(icao);
    if (!p) {
      p = this.fetchData(icao);
      this.pending.set(icao, p);
    }
    const data = await p;
    this.pending.delete(icao);
    if (!data || !data.buildings) {
      this.missing.add(icao);
      return;
    }
    if (this.loaded.has(icao) || this.layer === 'google3d') return;
    await this.ground.preload(airport);
    const base = this.ground.groundM(airport);
    this.loaded.set(icao, { data, airport, base, prims: this.build(data, base), kind: this.layer });
    this.updateCredit();
    this.onLoaded?.(icao);
  }

  private unload(icao: string) {
    const l = this.loaded.get(icao);
    if (!l) return;
    for (const p of l.prims) this.viewer.scene.primitives.remove(p);
    this.loaded.delete(icao);
    this.updateCredit();
  }

  private updateCredit() {
    const want = this.loaded.size > 0;
    if (want && !this.creditShown) this.viewer.creditDisplay.addStaticCredit(this.credit);
    if (!want && this.creditShown) this.viewer.creditDisplay.removeStaticCredit(this.credit);
    this.creditShown = want;
  }

  private build(a: Airport3D, base: number): Primitive[] {
    const o = a.origin;
    const pos = (ring: number[], h = 0) => {
      const out: Cartesian3[] = [];
      for (let i = 0; i < ring.length; i += 2) {
        const p = toLatLon(o, ring[i], ring[i + 1]);
        out.push(Cartesian3.fromDegrees(p.lon, p.lat, h));
      }
      return out;
    };
    const solid: GeometryInstance[] = [];
    const color = (c: Color) => ({ color: ColorGeometryInstanceAttribute.fromColor(c) });

    for (const b of a.buildings) {
      if (b.k === 'tower' && a.towers.length) continue; // drawn as shaft + glass cab below
      solid.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(pos(b.ring), (b.holes ?? []).map((h) => new PolygonHierarchy(pos(h)))),
            height: base + (b.min ?? 0),
            extrudedHeight: base + b.h,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: color(COLORS[b.k]),
        }),
      );
    }
    for (const t of a.towers.slice(0, 3)) {
      const p = toLatLon(o, t.x, t.y);
      const shaftLen = Math.max(8, t.h - 3);
      const at = (z: number) => Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(p.lon, p.lat, base + z));
      solid.push(
        new GeometryInstance({
          geometry: new CylinderGeometry({ length: shaftLen, topRadius: t.r * 0.45, bottomRadius: t.r * 0.6, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }),
          modelMatrix: at(shaftLen / 2),
          attributes: color(COLORS.tower),
        }),
        new GeometryInstance({
          geometry: new CylinderGeometry({ length: 6, topRadius: t.r * 1.05, bottomRadius: t.r * 0.8, slices: 16, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }),
          modelMatrix: at(shaftLen + 3),
          attributes: color(GLASS),
        }),
        new GeometryInstance({
          geometry: new CylinderGeometry({ length: 1.2, topRadius: t.r * 0.9, bottomRadius: t.r * 1.15, slices: 16, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }),
          modelMatrix: at(shaftLen + 6.6),
          attributes: color(COLORS.tower),
        }),
      );
    }
    for (const br of a.bridges) {
      solid.push(
        new GeometryInstance({
          geometry: new CorridorGeometry({
            positions: pos(br.line),
            width: br.w,
            height: base + 3.4,
            extrudedHeight: base + 6.4,
            cornerType: CornerType.MITERED,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: color(BRIDGE),
        }),
      );
    }
    const prims: Primitive[] = [];
    if (solid.length) {
      prims.push(
        this.viewer.scene.primitives.add(
          new Primitive({
            geometryInstances: solid,
            appearance: new PerInstanceColorAppearance({ closed: true, translucent: false }),
            asynchronous: true,
            releaseGeometryInstances: true,
          }),
        ),
      );
    }
    // Without imagery (offline globe) draw the paved areas too; with imagery the real ones are visible.
    if (this.layer === 'offline') {
      const flat: GeometryInstance[] = [];
      for (const ring of a.aprons) {
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
      if (flat.length) {
        prims.push(
          this.viewer.scene.primitives.add(
            new Primitive({ geometryInstances: flat, appearance: new PerInstanceColorAppearance({ flat: true }), asynchronous: true, releaseGeometryInstances: true }),
          ),
        );
      }
    }
    return prims;
  }

  destroy() {
    clearInterval(this.timer);
    this.viewer.camera.moveEnd.removeEventListener(this.refresh);
    for (const icao of [...this.loaded.keys()]) this.unload(icao);
  }
}
