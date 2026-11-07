/** Daily counters for cost guardrails. D1 in production; in-memory for tests and when no DB is bound. */
export interface CounterStore {
  /** Atomically add 1 and return the new count. */
  increment(day: string, subject: string, kind: string): Promise<number>;
  get(day: string, subject: string, kind: string): Promise<number>;
}

export class D1CounterStore implements CounterStore {
  constructor(private readonly db: D1Database) {}
  async increment(day: string, subject: string, kind: string): Promise<number> {
    const row = await this.db
      .prepare(
        'INSERT INTO quota_counters (day, subject, kind, count) VALUES (?, ?, ?, 1) ' +
          'ON CONFLICT(day, subject, kind) DO UPDATE SET count = count + 1 RETURNING count',
      )
      .bind(day, subject, kind)
      .first<{ count: number }>();
    return row?.count ?? 1;
  }
  async get(day: string, subject: string, kind: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT count FROM quota_counters WHERE day = ? AND subject = ? AND kind = ?')
      .bind(day, subject, kind)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }
}

export class MemoryCounterStore implements CounterStore {
  private readonly m = new Map<string, number>();
  async increment(day: string, subject: string, kind: string) {
    const k = `${day}|${subject}|${kind}`;
    const v = (this.m.get(k) ?? 0) + 1;
    this.m.set(k, v);
    return v;
  }
  async get(day: string, subject: string, kind: string) {
    return this.m.get(`${day}|${subject}|${kind}`) ?? 0;
  }
}

export function utcDay(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
