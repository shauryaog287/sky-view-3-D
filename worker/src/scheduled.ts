import type { Env } from './env';
import { intVar } from './env';
import { pruneTracks } from './flights/d1TrackSink';
import { evaluateAlerts } from './alerts/evaluate';
import { D1AlertStore } from './alerts/store';
import { airportIndex } from '../../shared/airportData';
import { hub } from './context';
import type { AircraftState } from '../../shared/types';
import { sendWebPush } from './push/webpush';
import { lookupFlightInfo } from './routes/info';

/** Cron (every minute): evaluate alerts; every 10 minutes prune track points older than the retention window. */
export async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const minute = new Date(controller.scheduledTime).getUTCMinutes();
  if (!env.DB) return;
  if (minute % 10 === 0) {
    const retentionMin = intVar(env.TRACK_RETENTION_MIN, 120);
    const removed = await pruneTracks(env.DB, Date.now() - retentionMin * 60_000);
    if (removed) console.log(`[cron] pruned ${removed} track points`);
  }
  const vapid =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:hello@example.com' }
      : undefined;
  const res = await evaluateAlerts({
    store: new D1AlertStore(env.DB),
    airports: airportIndex(),
    now: Date.now(),
    lookup: async (t) => {
      const qs = new URLSearchParams();
      if (t.hex) qs.set('hex', t.hex);
      if (t.callsign) qs.set('callsign', t.callsign);
      const r = await hub(env).fetch(`https://hub/lookup?${qs}`);
      return ((await r.json()) as { aircraft: AircraftState | null }).aircraft ?? undefined;
    },
    destination: env.ENRICHMENT === 'off' ? undefined : async (callsign, hex) => (await lookupFlightInfo(hex, callsign)).destination?.icao,
    push: vapid ? (sub, payload) => sendWebPush(sub, payload, vapid, { ttl: 1800, urgency: 'high', topic: payload.tag }) : undefined,
  });
  if (res.evaluated) console.log(`[cron] alerts evaluated=${res.evaluated} fired=${res.fired.length} missing=${res.missing}`);
}
