import type { AlertCondition, AlertRecord } from '../../../shared/apiTypes';
import type { PushSubscriptionJson } from '../push/webpush';

export interface AlertRow {
  id: string;
  device_id: string;
  user_id: string | null;
  hex: string | null;
  callsign: string | null;
  label: string;
  condition: AlertCondition;
  airport: string | null;
  push_sub: string | null;
  last_phase: string | null; // JSON PhaseMemory
  last_alt: number | null;
  created_at: number;
  expires_at: number;
  fired_at: number | null;
  active: number;
}

export interface AlertStore {
  listFor(owner: { deviceId?: string; userId?: string }): Promise<AlertRow[]>;
  countActive(owner: { deviceId?: string; userId?: string }): Promise<number>;
  insert(row: AlertRow): Promise<void>;
  remove(id: string, owner: { deviceId?: string; userId?: string }): Promise<boolean>;
  dueForEvaluation(now: number, limit: number): Promise<AlertRow[]>;
  update(id: string, patch: Partial<Pick<AlertRow, 'last_phase' | 'last_alt' | 'fired_at' | 'active' | 'push_sub'>>): Promise<void>;
  expire(now: number): Promise<number>;
}

export function toRecord(r: AlertRow): AlertRecord {
  return {
    id: r.id,
    hex: r.hex ?? undefined,
    callsign: r.callsign ?? undefined,
    label: r.label,
    condition: r.condition,
    airport: r.airport ?? undefined,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    firedAt: r.fired_at ?? undefined,
    active: r.active === 1,
    push: !!r.push_sub,
  };
}

export function parsePush(r: AlertRow): PushSubscriptionJson | undefined {
  if (!r.push_sub) return undefined;
  try {
    return JSON.parse(r.push_sub) as PushSubscriptionJson;
  } catch {
    return undefined;
  }
}

function ownerWhere(owner: { deviceId?: string; userId?: string }): [string, string[]] {
  if (owner.userId && owner.deviceId) return ['(user_id = ? OR device_id = ?)', [owner.userId, owner.deviceId]];
  if (owner.userId) return ['user_id = ?', [owner.userId]];
  return ['device_id = ?', [owner.deviceId ?? '__none__']];
}

export class D1AlertStore implements AlertStore {
  constructor(private readonly db: D1Database) {}
  async listFor(owner: { deviceId?: string; userId?: string }) {
    const [w, args] = ownerWhere(owner);
    const r = await this.db.prepare(`SELECT * FROM alerts WHERE ${w} ORDER BY created_at DESC LIMIT 50`).bind(...args).all<AlertRow>();
    return r.results ?? [];
  }
  async countActive(owner: { deviceId?: string; userId?: string }) {
    const [w, args] = ownerWhere(owner);
    const r = await this.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE active = 1 AND ${w}`).bind(...args).first<{ n: number }>();
    return r?.n ?? 0;
  }
  async insert(a: AlertRow) {
    await this.db
      .prepare(
        'INSERT INTO alerts (id, device_id, user_id, hex, callsign, label, condition, airport, push_sub, last_phase, last_alt, created_at, expires_at, fired_at, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(a.id, a.device_id, a.user_id, a.hex, a.callsign, a.label, a.condition, a.airport, a.push_sub, a.last_phase, a.last_alt, a.created_at, a.expires_at, a.fired_at, a.active)
      .run();
  }
  async remove(id: string, owner: { deviceId?: string; userId?: string }) {
    const [w, args] = ownerWhere(owner);
    const r = await this.db.prepare(`DELETE FROM alerts WHERE id = ? AND ${w}`).bind(id, ...args).run();
    return (r.meta.changes ?? 0) > 0;
  }
  async dueForEvaluation(now: number, limit: number) {
    const r = await this.db.prepare('SELECT * FROM alerts WHERE active = 1 AND expires_at > ? ORDER BY created_at ASC LIMIT ?').bind(now, limit).all<AlertRow>();
    return r.results ?? [];
  }
  async update(id: string, patch: Partial<Pick<AlertRow, 'last_phase' | 'last_alt' | 'fired_at' | 'active' | 'push_sub'>>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    await this.db
      .prepare(`UPDATE alerts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => patch[k] ?? null), id)
      .run();
  }
  async expire(now: number) {
    const r = await this.db.prepare('UPDATE alerts SET active = 0 WHERE active = 1 AND expires_at <= ?').bind(now).run();
    await this.db.prepare('DELETE FROM alerts WHERE expires_at < ?').bind(now - 7 * 86_400_000).run();
    return r.meta.changes ?? 0;
  }
}

export class MemoryAlertStore implements AlertStore {
  rows: AlertRow[] = [];
  private own(r: AlertRow, o: { deviceId?: string; userId?: string }) {
    return (o.userId && r.user_id === o.userId) || (o.deviceId && r.device_id === o.deviceId);
  }
  async listFor(o: { deviceId?: string; userId?: string }) {
    return this.rows.filter((r) => this.own(r, o));
  }
  async countActive(o: { deviceId?: string; userId?: string }) {
    return this.rows.filter((r) => r.active && this.own(r, o)).length;
  }
  async insert(r: AlertRow) {
    this.rows.push({ ...r });
  }
  async remove(id: string, o: { deviceId?: string; userId?: string }) {
    const n = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.id === id && this.own(r, o)));
    return this.rows.length < n;
  }
  async dueForEvaluation(now: number, limit: number) {
    return this.rows.filter((r) => r.active && r.expires_at > now).slice(0, limit);
  }
  async update(id: string, patch: Partial<AlertRow>) {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async expire(now: number) {
    let n = 0;
    for (const r of this.rows) if (r.active && r.expires_at <= now) (r.active = 0), n++;
    return n;
  }
}
