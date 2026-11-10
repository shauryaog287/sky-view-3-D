import { CustomHeightmapTerrainProvider, Math as CesiumMath, WebMercatorTilingScheme, type TerrainProvider } from 'cesium';
import type { AirportIndex } from '../../shared/airports';
import { BLEND_M, flatSite, flattenHeight, terrariumHeight, type FlatSite } from '../../shared/terrainFlatten';
import { haversineM } from '../../shared/geo';

/**
 * Real 3D terrain for the whole world without a key: the open "Terrain Tiles" elevation set on AWS (Tilezen/Mapzen
 * Joerd: SRTM, GMTED2010, ETOPO1 and national sources; ~30 m over land). Tiles are Terrarium-encoded PNGs in the
 * web-mercator scheme, decoded here into Cesium heightmaps.
 *
 *  - Heights are metres above sea level and are used as-is (sea level = 0), which matches aircraft altitudes and
 *    published airport elevations directly.
 *  - Every airport is flattened to its field elevation and blended into the surrounding terrain
 *    (shared/terrainFlatten.ts), so runways are level while table-top drops and mountains around them are real.
 *  - Sea floor is clamped to 0. Levels beyond the source's zoom are interpolated from the deepest tile.
 */
export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const TERRAIN_CREDIT = 'Terrain: Tilezen Terrain Tiles (SRTM, GMTED2010, ETOPO1 and others)';

const SOURCE_MAX_Z = 14;
const N = 65;
const PX = 256;
const CACHE_TILES = 220;
const MAX_PARALLEL = 10;

/** Heights in quarter-metres above −100 m (Uint16 keeps the cache small without visible terracing). */
type TileData = Uint16Array;
const enc = (h: number) => Math.max(0, Math.min(65535, Math.round((h + 100) * 4)));
const dec = (v: number) => v / 4 - 100;

export class OpenTerrain {
  private readonly cache = new Map<string, Promise<TileData | undefined>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly tiling = new WebMercatorTilingScheme();
  /** Set when a tile could not be fetched (offline, blocked): the globe then simply stays flat there. */
  failures = 0;

  constructor(private readonly airports: () => AirportIndex | undefined) {}

  create(): TerrainProvider {
    return new CustomHeightmapTerrainProvider({
      width: N,
      height: N,
      tilingScheme: this.tiling,
      credit: TERRAIN_CREDIT,
      callback: (x, y, level) => this.heights(x, y, level),
    });
  }

  private async heights(x: number, y: number, level: number): Promise<Float32Array> {
    // Source tile: this one, or its ancestor at the deepest source zoom with the matching sub-window.
    const up = Math.max(0, level - SOURCE_MAX_Z);
    const z = level - up;
    const sx = x >> up;
    const sy = y >> up;
    const data = await this.tile(z, sx, sy);
    // A rejected request makes Cesium fall back to the parent tile's (interpolated) terrain.
    if (!data) throw new Error(`terrain tile ${z}/${sx}/${sy} unavailable`);
    const scale = 1 / (1 << up);
    const u0 = (x - (sx << up)) * scale;
    const v0 = (y - (sy << up)) * scale;
    const rect = this.tiling.tileXYToRectangle(x, y, level);
    const out = new Float32Array(N * N);
    const sites = this.sitesNear(rect);
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat / 2));
    const mN = merc(rect.north);
    const mS = merc(rect.south);
    for (let j = 0; j < N; j++) {
      const fy = (v0 + (j / (N - 1)) * scale) * (PX - 1);
      const lat = sites.length ? CesiumMath.toDegrees(2 * Math.atan(Math.exp(mN + ((mS - mN) * j) / (N - 1))) - Math.PI / 2) : 0;
      for (let i = 0; i < N; i++) {
        const fx = (u0 + (i / (N - 1)) * scale) * (PX - 1);
        let h = Math.max(0, bilinear(data, fx, fy));
        if (sites.length) h = flattenHeight(h, lat, CesiumMath.toDegrees(rect.west + ((rect.east - rect.west) * i) / (N - 1)), sites);
        out[j * N + i] = h;
      }
    }
    return out;
  }

  private sitesNear(rect: { west: number; south: number; east: number; north: number }): FlatSite[] {
    const idx = this.airports();
    if (!idx) return [];
    const lat = CesiumMath.toDegrees((rect.north + rect.south) / 2);
    const lon = CesiumMath.toDegrees((rect.east + rect.west) / 2);
    const radius = haversineM(lat, lon, CesiumMath.toDegrees(rect.north), CesiumMath.toDegrees(rect.east));
    // Whole-continent tiles: nothing to flatten at that scale.
    if (radius > 400_000) return [];
    return idx.within(lat, lon, radius + 6000 + BLEND_M).map((x) => this.site(x.airport));
  }

  private readonly sites = new Map<string, FlatSite>();
  private site(a: Parameters<typeof flatSite>[0] & { ident: string }): FlatSite {
    let s = this.sites.get(a.ident);
    if (!s) this.sites.set(a.ident, (s = flatSite(a)));
    return s;
  }

  private tile(z: number, x: number, y: number): Promise<TileData | undefined> {
    const key = `${z}/${x}/${y}`;
    let p = this.cache.get(key);
    if (p) {
      // Refresh LRU position.
      this.cache.delete(key);
      this.cache.set(key, p);
      return p;
    }
    p = this.load(key).catch(() => {
      this.failures++;
      // Do not cache failures: the tile is retried when requested again.
      this.cache.delete(key);
      return undefined;
    });
    this.cache.set(key, p);
    if (this.cache.size > CACHE_TILES) this.cache.delete(this.cache.keys().next().value as string);
    return p;
  }

  private async load(key: string): Promise<TileData> {
    if (this.active >= MAX_PARALLEL) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      const res = await fetch(`${TERRAIN_TILES}/${key}.png`, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`terrain ${key}: HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(PX, PX) : Object.assign(document.createElement('canvas'), { width: PX, height: PX });
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      ctx.drawImage(bmp, 0, 0, PX, PX);
      bmp.close();
      const px = ctx.getImageData(0, 0, PX, PX).data;
      const out = new Uint16Array(PX * PX);
      for (let i = 0; i < PX * PX; i++) out[i] = enc(terrariumHeight(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]));
      return out;
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

function bilinear(d: TileData, fx: number, fy: number): number {
  const x0 = Math.min(PX - 1, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(PX - 1, Math.max(0, Math.floor(fy)));
  const x1 = Math.min(PX - 1, x0 + 1);
  const y1 = Math.min(PX - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = dec(d[y0 * PX + x0]);
  const b = dec(d[y0 * PX + x1]);
  const c = dec(d[y1 * PX + x0]);
  const e = dec(d[y1 * PX + x1]);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}
