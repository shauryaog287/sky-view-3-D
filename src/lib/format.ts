/** Display formatting for aviation values. */
export function fmtAlt(ft: number | null | undefined): string {
  if (ft === null) return 'Ground';
  if (ft === undefined || !Number.isFinite(ft)) return '—';
  if (ft >= 18_000) return `FL${Math.round(ft / 100)}`;
  const rounded = ft < 1000 ? Math.round(ft / 10) * 10 : Math.round(ft / 50) * 50;
  return `${rounded.toLocaleString('en-US')} ft`;
}

export function fmtAltFeet(ft: number | null | undefined): string {
  if (ft === null) return 'GND';
  if (ft === undefined || !Number.isFinite(ft)) return '—';
  return `${Math.round(ft).toLocaleString('en-US')} ft`;
}

export function fmtSpeed(kt: number | undefined): string {
  if (kt === undefined || !Number.isFinite(kt)) return '—';
  return `${Math.round(kt)} kt`;
}

export function fmtKmh(kt: number | undefined): string {
  if (kt === undefined || !Number.isFinite(kt)) return '';
  return `${Math.round(kt * 1.852)} km/h`;
}

export function fmtHeading(deg: number | undefined): string {
  if (deg === undefined || !Number.isFinite(deg)) return '—';
  return `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
}

export function fmtVs(fpm: number | undefined): string {
  if (fpm === undefined || !Number.isFinite(fpm)) return '—';
  if (Math.abs(fpm) < 100) return 'Level';
  return `${fpm > 0 ? '↑' : '↓'} ${Math.abs(Math.round(fpm / 10) * 10).toLocaleString('en-US')} fpm`;
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
}

export type Freshness = 'live' | 'estimated' | 'stale';
export function freshness(ageMs: number): Freshness {
  return ageMs < 12_000 ? 'live' : ageMs < 45_000 ? 'estimated' : 'stale';
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
