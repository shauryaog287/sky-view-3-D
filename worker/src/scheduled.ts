import type { Env } from './env';
import { intVar } from './env';
import { pruneTracks } from './flights/d1TrackSink';

/** Cron (every minute): prune old track points every 10 minutes. Alerts are evaluated here too (M6). */
export async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const minute = new Date(controller.scheduledTime).getUTCMinutes();
  if (env.DB && minute % 10 === 0) {
    const retentionMin = intVar(env.TRACK_RETENTION_MIN, 120);
    const removed = await pruneTracks(env.DB, Date.now() - retentionMin * 60_000);
    if (removed) console.log(`[cron] pruned ${removed} track points`);
  }
}
