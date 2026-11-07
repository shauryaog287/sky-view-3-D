import type { ModelClass } from '../../shared/aircraftTypes';

/** Top-down aircraft silhouettes (nose up), drawn once into canvases and used as billboard images. */
const PATHS: Record<'jet' | 'prop' | 'heli' | 'light', string> = {
  jet: 'M32 3c2 0 3.2 2.6 3.2 6v14.5L60 36.5v4.2l-24.8-7.4v16.2l7.4 5.6v3.6L32 56l-10.6 2.7v-3.6l7.4-5.6V33.3L4 40.7v-4.2l24.8-13V9c0-3.4 1.2-6 3.2-6z',
  prop: 'M32 4c1.8 0 3 2.4 3 5.6V22h24v5.5H35v20.5l8 4.5v3.5L32 54l-11 2v-3.5l8-4.5V27.5H5V22h24V9.6C29 6.4 30.2 4 32 4z',
  light: 'M32 6c1.6 0 2.6 2 2.6 4.5V24h22v4.6h-22V46l6.4 3.4V53L32 51.5 23 53v-3.6l6.4-3.4V28.6h-22V24h22V10.5C29.4 8 30.4 6 32 6z',
  heli: 'M32 12c4.4 0 7 3.6 7 8.5 0 5-2.6 9-7 9s-7-4-7-9c0-4.9 2.6-8.5 7-8.5zm-1.4 17h2.8v22h4.6v3h-12v-3h4.6zM8 18.5l48 6.5-.5 3L7.5 21.5zM56.5 18.5l.5 3-48.5 6.5-.5-3z',
};

function shapeFor(c: ModelClass): keyof typeof PATHS {
  if (c === 'helicopter') return 'heli';
  if (c === 'turboprop') return 'prop';
  if (c === 'light') return 'light';
  return 'jet';
}

const cache = new Map<string, string>();

/** Data URL of a white silhouette with a dark outline; tint it with Billboard.color. */
export function aircraftIcon(c: ModelClass): string {
  const shape = shapeFor(c);
  const hit = cache.get(shape);
  if (hit) return hit;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const p = new Path2D(PATHS[shape]);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke(p);
  ctx.fillStyle = '#ffffff';
  ctx.fill(p);
  const url = canvas.toDataURL('image/png');
  cache.set(shape, url);
  return url;
}

export const ICON_SCALE: Record<ModelClass, number> = {
  widebody: 0.62,
  narrowbody: 0.52,
  generic: 0.5,
  regional: 0.46,
  turboprop: 0.46,
  bizjet: 0.4,
  helicopter: 0.42,
  light: 0.36,
};
