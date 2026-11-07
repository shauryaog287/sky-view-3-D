import {
  Cartesian3,
  ClippingPolygon,
  ClippingPolygonCollection,
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  Math as CesiumMath,
  type Cesium3DTileset,
  type TerrainProvider,
  type Viewer,
} from 'cesium';
import { airportArea } from '../../shared/airport3d';
import type { Airport, AirportIndex } from '../../shared/airports';
import { haversineM } from '../../shared/geo';
import { flatGroundHeight } from '../../shared/flatGround';
import type { BaseLayers } from './baseLayers';
import type { GroundHeights } from './ground';
import type { Airport3DLayer } from './airport3dLayer';

export type PhotorealScopeMode = 'airports' | 'everywhere';

interface Area {
  airport: Airport;
  ring: { lat: number; lon: number }[];
  /** Rendered ground height at the airport (ellipsoid metres). */
  groundM: number;
  /** Distance from the airport reference point to the farthest outline vertex. */
  radiusM: number;
}

/** The flat 2D map tucks this far under the edge of each 3D airport (and sits PLANE_DROP_M below it). */
const EDGE_OVERLAP_M = 90;

/** Airports whose photoreal 3D is kept around the camera. */
const MAX_AREAS = 6;
const SEARCH_M = 90_000;
const MAX_CAMERA_HEIGHT_M = 120_000;

/**
 * "3D at airports, plain 2D city": Google Photorealistic 3D Tiles are clipped to the outline of each nearby airport
 * (runways, terminals, aprons, taxiways — shared/airport3d.ts `airportArea`). Everything else is the flat 2D
 * satellite map. The 2D map is laid on a flat surface at the airports' own ground height, so the 3D airport sits
 * flush with it instead of floating. Away from airports the 3D tileset is hidden entirely (nothing to stream).
 * Needs WebGL 2 (clipping polygons); without it the tiles are only shown while the camera is near an airport.
 */
export class PhotorealScope {
  mode: PhotorealScopeMode = 'airports';
  private airports?: AirportIndex;
  private appliedKey = '';
  private running = false;
  private again = false;
  private plane?: TerrainProvider;
  private readonly timer: ReturnType<typeof setInterval>;
  /** Current areas (for tests and the status line). */
  areas: Area[] = [];

  constructor(
    private readonly viewer: Viewer,
    private readonly layers: BaseLayers,
    private readonly ground: GroundHeights,
    private readonly scenery: Airport3DLayer,
  ) {
    viewer.camera.moveEnd.addEventListener(this.refresh);
    // Follow cameras move without moveEnd, and ground heights arrive asynchronously.
    this.timer = setInterval(this.refresh, 2500);
    layers.onChange(() => {
      this.appliedKey = '';
      this.refresh();
    });
  }

  setAirports(a: AirportIndex) {
    this.airports = a;
    this.refresh();
  }

  setMode(mode: PhotorealScopeMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.appliedKey = '';
    this.refresh();
  }

  readonly refresh = () => {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.update()
      .catch((e) => console.warn('[photoreal scope]', e))
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.refresh();
        }
      });
  };

  private async update() {
    const ts = this.layers.googleTileset;
    if (!ts) {
      if (this.appliedKey !== 'off') this.reset();
      this.appliedKey = 'off';
      return;
    }
    if (this.mode === 'everywhere') {
      if (this.appliedKey !== 'everywhere') this.everywhere(ts);
      this.appliedKey = 'everywhere';
      return;
    }
    const cam = this.viewer.camera.positionCartographic;
    const lat = CesiumMath.toDegrees(cam.latitude);
    const lon = CesiumMath.toDegrees(cam.longitude);
    const near =
      this.airports && cam.height < MAX_CAMERA_HEIGHT_M
        ? this.airports
            .within(lat, lon, SEARCH_M)
            .filter((x) => x.airport.kind !== 'S' && x.airport.runways.length > 0)
            .slice(0, MAX_AREAS)
        : [];
    const areas: Area[] = [];
    for (const { airport } of near) {
      const data = await this.scenery.dataFor(airport.ident).catch(() => null);
      const ring = airportArea(airport, data);
      const radiusM = Math.max(...ring.map((p) => haversineM(airport.lat, airport.lon, p.lat, p.lon)));
      areas.push({ airport, ring, groundM: this.ground.groundM(airport), radiusM });
    }
    // Re-apply only when the set of airports or their ground heights change (each apply rebuilds the flat terrain).
    const key = areas.map((a) => `${a.airport.ident}:${Math.round(a.groundM)}`).join(',') || 'none';
    if (key === this.appliedKey || this.layers.googleTileset !== ts) return;
    this.apply(ts, areas);
    this.appliedKey = key;
  }

  private apply(ts: Cesium3DTileset, areas: Area[]) {
    const { scene } = this.viewer;
    this.areas = areas;
    this.layers.showFlatImagery(true);
    if (!areas.length) {
      ts.show = false;
      scene.globe.clippingPolygons = undefined as unknown as ClippingPolygonCollection;
      scene.globe.show = true;
      this.setTerrain(new EllipsoidTerrainProvider());
      return;
    }
    ts.show = true;
    scene.globe.show = true;
    this.setTerrain(airportPlane(areas));
    // Measure each airport's real ground on the (now visible) 3D tiles; the next refresh re-levels the 2D map.
    for (const a of areas) if (!this.ground.isSampled(a.airport)) void this.ground.preload(a.airport).then(() => this.refresh());
    if (!ClippingPolygonCollection.isSupported(scene)) {
      // Older WebGL 1 devices: no clipping; the full 3D tiles show while near an airport and cover the 2D map.
      scene.globe.show = false;
      return;
    }
    const polygon = (ring: { lat: number; lon: number }[]) => new ClippingPolygon({ positions: Cartesian3.fromDegreesArray(ring.flatMap((p) => [p.lon, p.lat])) });
    ts.clippingPolygons = new ClippingPolygonCollection({ polygons: areas.map((a) => polygon(a.ring)), inverse: true });
    // The 2D map's hole is a little smaller than the 3D area and the map sits a little lower (see airportPlane), so
    // the two overlap under the airport's edge: no gap whatever the terrain does along the boundary.
    scene.globe.clippingPolygons = new ClippingPolygonCollection({ polygons: areas.map((a) => polygon(inset(a.ring, EDGE_OVERLAP_M))), inverse: false });
  }

  /** Photoreal everywhere (the original behaviour): full tileset, no globe. */
  private everywhere(ts: Cesium3DTileset) {
    this.areas = [];
    ts.clippingPolygons = undefined as unknown as ClippingPolygonCollection;
    ts.show = true;
    this.viewer.scene.globe.clippingPolygons = undefined as unknown as ClippingPolygonCollection;
    this.viewer.scene.globe.show = false;
    this.setTerrain(new EllipsoidTerrainProvider());
  }

  /** Left photoreal mode: undo our globe changes (the new layer sets its own terrain). */
  private reset() {
    this.areas = [];
    this.viewer.scene.globe.clippingPolygons = undefined as unknown as ClippingPolygonCollection;
    if (this.plane && this.viewer.scene.terrainProvider === this.plane) this.viewer.scene.terrainProvider = new EllipsoidTerrainProvider();
    this.plane = undefined;
  }

  private setTerrain(t: TerrainProvider) {
    this.plane = t;
    this.viewer.scene.terrainProvider = t;
  }

  destroy() {
    clearInterval(this.timer);
    this.viewer.camera.moveEnd.removeEventListener(this.refresh);
  }
}

/**
 * Flat terrain for the 2D map: exactly each airport's ground height around it, blended smoothly in between (and the
 * nearest airports' height further out), so the clipped 3D airports meet the 2D map without a step.
 */
export function airportPlane(areas: { airport: Airport; groundM: number; radiusM: number }[]): TerrainProvider {
  const tiling = new GeographicTilingScheme();
  const N = 17;
  const pts = areas.map((a) => ({ lat: a.airport.lat, lon: a.airport.lon, groundM: a.groundM, radiusM: a.radiusM }));
  const heightAt = (lat: number, lon: number) => flatGroundHeight(pts, lat, lon);
  return new CustomHeightmapTerrainProvider({
    width: N,
    height: N,
    tilingScheme: tiling,
    callback: (x, y, level) => {
      const r = tiling.tileXYToRectangle(x, y, level);
      const out = new Float32Array(N * N);
      // Heightmaps start at the north-west corner, row by row southwards.
      for (let j = 0; j < N; j++) {
        const lat = CesiumMath.toDegrees(r.north - ((r.north - r.south) * j) / (N - 1));
        for (let i = 0; i < N; i++) {
          const lon = CesiumMath.toDegrees(r.west + ((r.east - r.west) * i) / (N - 1));
          out[j * N + i] = heightAt(lat, lon);
        }
      }
      return out;
    },
  });
}

/** Shrink a convex ring towards its centre by about `m` metres. */
function inset(ring: { lat: number; lon: number }[], m: number): { lat: number; lon: number }[] {
  const c = ring.reduce((s, p) => ({ lat: s.lat + p.lat / ring.length, lon: s.lon + p.lon / ring.length }), { lat: 0, lon: 0 });
  return ring.map((p) => {
    const d = haversineM(c.lat, c.lon, p.lat, p.lon);
    const k = d > 0 ? Math.max(0, 1 - Math.min(m, d * 0.1) / d) : 1;
    return { lat: c.lat + (p.lat - c.lat) * k, lon: c.lon + (p.lon - c.lon) * k };
  });
}
