import { type BBox, bboxCenter, haversineM, NM_TO_M, clamp } from './geo';

/**
 * Region buckets: the world is cut into fixed grid cells so every user looking at the same area shares one
 * upstream request. Two levels: fine (2°) for normal views and coarse (6°) for zoomed-out views.
 */
export interface Bucket {
  id: string;
  level: 0 | 1;
  lat: number; // centre
  lon: number;
  /** Query radius (nautical miles) that covers the whole cell; capped at the provider maximum. */
  radiusNm: number;
  bbox: BBox;
}

export const BUCKET_LEVELS = [
  { size: 2, maxCells: 9 },
  { size: 6, maxCells: 12 },
] as const;
export const MAX_RADIUS_NM = 250;

export function bucketFor(level: 0 | 1, latIdx: number, lonIdx: number): Bucket {
  const size = BUCKET_LEVELS[level].size;
  const minLat = clamp(latIdx * size, -90, 90);
  const maxLat = clamp(minLat + size, -90, 90);
  const minLon = lonIdx * size;
  const maxLon = minLon + size;
  const lat = (minLat + maxLat) / 2;
  const lon = (((minLon + size / 2 + 180) % 360) + 360) % 360 - 180;
  const cornerM = haversineM(lat, lon, maxLat, minLon);
  return {
    id: `L${level}:${latIdx}:${lonIdx}`,
    level,
    lat,
    lon,
    radiusNm: Math.min(MAX_RADIUS_NM, Math.ceil(cornerM / NM_TO_M) + 2),
    bbox: { minLat, maxLat, minLon: ((minLon + 540) % 360) - 180, maxLon: ((maxLon + 540) % 360) - 180 },
  };
}

export function parseBucketId(id: string): Bucket | undefined {
  const m = /^L([01]):(-?\d+):(-?\d+)$/.exec(id);
  if (!m) return undefined;
  return bucketFor(Number(m[1]) as 0 | 1, Number(m[2]), Number(m[3]));
}

function cellsFor(b: BBox, size: number): [number, number][] {
  const out: [number, number][] = [];
  const la0 = Math.floor(clamp(b.minLat, -89.999, 89.999) / size);
  const la1 = Math.floor(clamp(b.maxLat, -89.999, 89.999) / size);
  let maxLon = b.maxLon;
  if (maxLon < b.minLon) maxLon += 360;
  const lo0 = Math.floor((b.minLon + 180) / size);
  const lo1 = Math.floor((maxLon + 180) / size);
  const lonCells = Math.round(360 / size);
  for (let la = la0; la <= la1; la++) {
    for (let lo = lo0; lo <= lo1 && lo - lo0 < lonCells; lo++) {
      out.push([la, (lo % lonCells) - Math.round(180 / size)]);
    }
  }
  return out;
}

export interface BucketPlan {
  buckets: Bucket[];
  truncated: boolean;
}

/** Choose the buckets to poll for a view. Prefers fine cells; falls back to coarse; truncates to nearest centre. */
export function planBuckets(view: BBox): BucketPlan {
  const center = bboxCenter(view);
  for (const level of [0, 1] as const) {
    const { size, maxCells } = BUCKET_LEVELS[level];
    const cells = cellsFor(view, size);
    if (cells.length <= maxCells || level === 1) {
      const buckets = cells
        .map(([la, lo]) => bucketFor(level, la, lo))
        .sort((a, b) => haversineM(center.lat, center.lon, a.lat, a.lon) - haversineM(center.lat, center.lon, b.lat, b.lon));
      const truncated = buckets.length > maxCells;
      return { buckets: buckets.slice(0, maxCells), truncated };
    }
  }
  return { buckets: [], truncated: false };
}
