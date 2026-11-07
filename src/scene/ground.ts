import { Cartographic, sampleTerrainMostDetailed, type Viewer, type Cesium3DTileset } from 'cesium';
import type { Airport } from '../../shared/airports';
import { FT_TO_M } from '../../shared/geo';
import type { BaseLayerKind } from './baseLayers';

interface Entry {
  /** Ellipsoid height of the airfield surface (m), as rendered by the current base layer. */
  groundM: number;
  sampled: boolean;
  pending?: Promise<void>;
}

/**
 * Ground heights at airports, *as rendered by the current base layer*.
 *
 * ADS-B altitudes are pressure altitudes (≈ MSL) while Cesium renders ellipsoid heights, and Google 3D tiles / ion terrain
 * each have their own surface. Sampling the rendered surface at the runway gives `offset = ground − fieldElevation`, a
 * local correction (geoid undulation + terrain model differences) that makes landing aircraft touch the drawn runway.
 *
 * Sampling with `sampleHeightMostDetailed` also forces the 3D tiles around that point to load — which is exactly the
 * "pre-load tiles around the destination airport" behaviour we want when a followed flight starts descending.
 */
export class GroundHeights {
  private readonly cache = new Map<string, Entry>();
  private layer: BaseLayerKind = 'offline';
  /** Altimeter correction per airport (ft), from METAR QNH. */
  private readonly qnhFt = new Map<string, number>();

  constructor(
    private readonly viewer: Viewer,
    private readonly tileset: () => Cesium3DTileset | undefined,
    private readonly exclude: () => object[] = () => [],
  ) {}

  setLayer(kind: BaseLayerKind) {
    if (kind !== this.layer) {
      this.layer = kind;
      this.cache.clear();
    }
  }

  setQnh(icao: string, hpa: number | undefined) {
    if (hpa === undefined) this.qnhFt.delete(icao);
    // Pressure altitude reads low when QNH > 1013.25: true altitude ≈ PA + 27 ft/hPa × (QNH − 1013.25).
    else this.qnhFt.set(icao, (hpa - 1013.25) * 27);
  }

  qnhCorrectionFt(icao: string): number {
    return this.qnhFt.get(icao) ?? 0;
  }

  /** Rendered ground height (m) for a runway/airfield at `elevFt`. Starts sampling on first use. */
  private get ellipsoid(): boolean {
    return this.layer === 'offline' || this.layer === 'satellite';
  }

  groundM(airport: Airport, elevFt = airport.elevFt): number {
    if (this.ellipsoid) return 0;
    const e = this.entry(airport);
    // Before sampling finishes assume MSL ≈ ellipsoid (off by the geoid undulation, typically < 100 m).
    if (!e.sampled) return elevFt * FT_TO_M;
    return e.groundM + (elevFt - airport.elevFt) * FT_TO_M;
  }

  /** Height to add to pressure altitude (converted to m) near this airport. */
  offsetM(airport: Airport): number {
    return this.groundM(airport) - airport.elevFt * FT_TO_M + this.qnhCorrectionFt(airport.ident) * FT_TO_M;
  }

  /** Force-load tiles around an airport (runway ends + reference point) and sample its ground height. */
  preload(airport: Airport): Promise<void> {
    return this.entry(airport).pending ?? Promise.resolve();
  }

  /** Sample the rendered surface height at an arbitrary point (used to place ground cameras above buildings). */
  async sampleAt(lat: number, lon: number): Promise<number | undefined> {
    const c = [Cartographic.fromDegrees(lon, lat)];
    try {
      if (this.layer === 'google3d' && this.tileset()) {
        const r = await this.viewer.scene.sampleHeightMostDetailed(c, this.exclude());
        return r[0]?.height;
      }
      if (this.layer === 'ion') {
        const r = await sampleTerrainMostDetailed(this.viewer.terrainProvider, c);
        return r[0]?.height;
      }
    } catch {
      /* fall through */
    }
    return this.ellipsoid ? 0 : undefined;
  }

  private entry(airport: Airport): Entry {
    const key = airport.ident;
    let e = this.cache.get(key);
    if (e) return e;
    e = { groundM: airport.elevFt * FT_TO_M, sampled: this.ellipsoid };
    this.cache.set(key, e);
    if (!this.ellipsoid) e.pending = this.sample(airport, e);
    return e;
  }

  private async sample(airport: Airport, e: Entry) {
    const pts: Cartographic[] = [];
    for (const r of airport.runways.slice(0, 4)) {
      pts.push(Cartographic.fromDegrees(r.le.lon, r.le.lat), Cartographic.fromDegrees(r.he.lon, r.he.lat));
    }
    if (!pts.length) pts.push(Cartographic.fromDegrees(airport.lon, airport.lat));
    try {
      let heights: number[] = [];
      if (this.layer === 'google3d' && this.tileset()) {
        const r = await this.viewer.scene.sampleHeightMostDetailed(pts, this.exclude());
        heights = r.map((c) => c?.height).filter((h): h is number => Number.isFinite(h));
      } else if (this.layer === 'ion') {
        const r = await sampleTerrainMostDetailed(this.viewer.terrainProvider, pts);
        heights = r.map((c) => c.height).filter((h) => Number.isFinite(h));
      }
      if (heights.length) {
        // Runway ends sit at different elevations; reference everything to the field elevation via each end's offset.
        heights.sort((a, b) => a - b);
        const median = heights[Math.floor(heights.length / 2)];
        const medianElevFt = (() => {
          const elevs = airport.runways.slice(0, 4).flatMap((r) => [r.le.elevFt, r.he.elevFt]).sort((a, b) => a - b);
          return elevs.length ? elevs[Math.floor(elevs.length / 2)] : airport.elevFt;
        })();
        e.groundM = median - (medianElevFt - airport.elevFt) * FT_TO_M;
        e.sampled = true;
      }
    } catch (err) {
      console.warn('[ground] sampling failed for', airport.ident, err);
    } finally {
      e.pending = undefined;
      // Tiles may simply not have been reachable yet: allow another attempt later.
      if (!e.sampled) setTimeout(() => this.cache.get(airport.ident) === e && this.cache.delete(airport.ident), 30_000);
    }
  }
}
