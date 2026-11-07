import type { TrackPoint } from '../../../shared/types';
import type { TrackSink } from './trackRecorder';

/** Writes track points to D1 in batched multi-row INSERTs (D1 allows up to 100 bound parameters per statement). */
export class D1TrackSink implements TrackSink {
  constructor(private readonly db: D1Database) {}

  async write(points: TrackPoint[]): Promise<void> {
    const COLS = 8;
    const ROWS_PER_STMT = Math.floor(100 / COLS);
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < points.length; i += ROWS_PER_STMT) {
      const chunk = points.slice(i, i + ROWS_PER_STMT);
      const sql =
        'INSERT OR REPLACE INTO track_points (hex, ts, lat, lon, alt, gs, track, vrate) VALUES ' +
        chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',');
      stmts.push(this.db.prepare(sql).bind(...chunk.flatMap((p) => [p.hex, p.ts, p.lat, p.lon, p.alt, p.gs, p.track, p.vrate])));
    }
    // db.batch runs as one implicit transaction.
    for (let i = 0; i < stmts.length; i += 50) await this.db.batch(stmts.slice(i, i + 50));
  }
}

export async function readTrack(db: D1Database, hex: string, sinceMs: number): Promise<TrackPoint[]> {
  const res = await db
    .prepare('SELECT hex, ts, lat, lon, alt, gs, track, vrate FROM track_points WHERE hex = ? AND ts >= ? ORDER BY ts ASC LIMIT 2000')
    .bind(hex, sinceMs)
    .all<TrackPoint>();
  return res.results ?? [];
}

export async function pruneTracks(db: D1Database, olderThanMs: number): Promise<number> {
  const res = await db.prepare('DELETE FROM track_points WHERE ts < ?').bind(olderThanMs).run();
  return res.meta.changes ?? 0;
}
