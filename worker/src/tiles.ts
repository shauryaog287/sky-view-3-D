import type { CounterStore } from './lib/counters';

export interface TilesCapConfig {
  perSubjectPerDay: number;
  /** Per-IP cap (stops one device minting endless device ids). */
  perIpPerDay: number;
  globalPerDay: number;
}

export interface TilesCapResult {
  allowed: boolean;
  reason?: 'subject_cap' | 'ip_cap' | 'global_cap';
  usedToday: number;
  limitToday: number;
}

/**
 * Google Photorealistic 3D Tiles are billed per root-tileset request ("session"). The client asks once per viewing
 * session; we count it against the user/device, the IP and a global daily budget. Over any cap → the client falls back
 * to the cheaper layer. Counters only ever increase, so a denied request still costs nothing upstream.
 */
export async function checkTilesSession(
  store: CounterStore,
  cfg: TilesCapConfig,
  who: { subject: string; ipHash?: string },
  day: string,
): Promise<TilesCapResult> {
  const used = await store.increment(day, who.subject, 'tiles_session');
  if (used > cfg.perSubjectPerDay) return { allowed: false, reason: 'subject_cap', usedToday: used - 1, limitToday: cfg.perSubjectPerDay };
  if (who.ipHash) {
    const ipUsed = await store.increment(day, `ip:${who.ipHash}`, 'tiles_session');
    if (ipUsed > cfg.perIpPerDay) return { allowed: false, reason: 'ip_cap', usedToday: used, limitToday: cfg.perSubjectPerDay };
  }
  const global = await store.increment(day, 'global', 'tiles_session');
  if (global > cfg.globalPerDay) return { allowed: false, reason: 'global_cap', usedToday: used, limitToday: cfg.perSubjectPerDay };
  return { allowed: true, usedToday: used, limitToday: cfg.perSubjectPerDay };
}
