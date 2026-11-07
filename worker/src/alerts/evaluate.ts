import type { AircraftState } from '../../../shared/types';
import type { AirportIndex } from '../../../shared/airports';
import { detectPhase, type PhaseMemory } from '../../../shared/phase';
import { alertTriggered, CONDITION_LABEL } from '../../../shared/alertRules';
import { parsePush, type AlertRow, type AlertStore } from './store';
import type { PushSubscriptionJson } from '../push/webpush';

export interface EvaluateDeps {
  store: AlertStore;
  airports: AirportIndex;
  lookup: (t: { hex?: string; callsign?: string }) => Promise<AircraftState | undefined>;
  /** Destination ICAO from route enrichment (best effort). */
  destination?: (callsign: string | undefined, hex: string) => Promise<string | undefined>;
  push?: (sub: PushSubscriptionJson, payload: { title: string; body: string; tag: string; url: string }) => Promise<{ gone: boolean }>;
  now: number;
  limit?: number;
}

export interface EvaluateResult {
  evaluated: number;
  fired: string[];
  missing: number;
}

/**
 * Cron step: for every active alert, fetch the aircraft's latest state (shared by alerts on the same flight), run phase
 * detection with the memory stored on the alert row, and fire (Web Push) when the condition is met. One-shot: a fired
 * alert is deactivated. Alerts expire 24 h after creation.
 */
export async function evaluateAlerts(d: EvaluateDeps): Promise<EvaluateResult> {
  await d.store.expire(d.now);
  const due = await d.store.dueForEvaluation(d.now, d.limit ?? 60);
  const states = new Map<string, Promise<AircraftState | undefined>>();
  const res: EvaluateResult = { evaluated: 0, fired: [], missing: 0 };
  for (const a of due) {
    const key = a.hex ?? `cs:${a.callsign}`;
    if (!states.has(key)) states.set(key, d.lookup({ hex: a.hex ?? undefined, callsign: a.callsign ?? undefined }).catch(() => undefined));
    const st = await states.get(key)!;
    res.evaluated++;
    let mem: PhaseMemory | undefined;
    try {
      mem = a.last_phase ? (JSON.parse(a.last_phase) as PhaseMemory) : undefined;
    } catch {
      mem = undefined;
    }
    if (!st) {
      res.missing++;
      // Many aircraft stop transmitting right after landing: treat "was landing, now gone" as landed.
      if (a.condition === 'landed' && mem?.phase === 'landing' && !a.airport) {
        res.fired.push(a.id);
        await d.store.update(a.id, { fired_at: d.now, active: 0 });
        const sub = parsePush(a);
        if (sub && d.push) {
          await d.push(sub, { title: `${a.label} ${CONDITION_LABEL.landed}`, body: 'Touchdown — the flight has stopped reporting.', tag: `alert-${a.id}`, url: '/' }).catch(() => undefined);
        }
      }
      continue;
    }
    const r = detectPhase(
      { t: st.posTs, lat: st.lat, lon: st.lon, onGround: st.onGround, altFt: st.altBaro ?? st.altGeom, gsKt: st.gs, vrateFpm: st.vrate, track: st.track },
      d.airports,
      mem,
    );
    let airportMatch: boolean | undefined;
    if (a.airport) {
      const want = d.airports.get(a.airport)?.ident ?? a.airport.toUpperCase();
      const rwyAirport = r.runway && r.runway.distToEndM < 30_000 ? r.runway.airport.ident : undefined;
      const dest = d.destination ? await d.destination(st.callsign, st.hex).catch(() => undefined) : undefined;
      if (rwyAirport === want || dest === want) airportMatch = true;
      else if (dest && dest !== want) airportMatch = false;
      else if (a.condition !== 'descent' && rwyAirport && rwyAirport !== want) airportMatch = false;
    }
    const fire = alertTriggered(a.condition, mem?.phase, r.phase, { airportMatch, aglFt: r.aglFt, onGround: st.onGround });
    if (fire) {
      res.fired.push(a.id);
      await d.store.update(a.id, { last_phase: JSON.stringify(r.memory), fired_at: d.now, active: 0 });
      const sub = parsePush(a);
      if (sub && d.push) {
        const where = a.airport ? ` (${a.airport})` : '';
        const out = await d.push(sub, {
          title: `${a.label} ${CONDITION_LABEL[a.condition]}${where}`,
          body: describe(st, r.aglFt),
          tag: `alert-${a.id}`,
          url: `/?follow=${encodeURIComponent(st.hex)}`,
        }).catch(() => ({ gone: false }));
        if (out.gone) await d.store.update(a.id, { push_sub: null });
      }
    } else {
      await d.store.update(a.id, { last_phase: JSON.stringify(r.memory), last_alt: st.altBaro ?? null });
    }
  }
  return res;
}

function describe(s: AircraftState, agl?: number): string {
  const alt = s.onGround ? 'on the ground' : `${Math.round((s.altBaro ?? s.altGeom ?? 0) / 100) * 100} ft`;
  const vs = s.vrate && Math.abs(s.vrate) > 200 ? `, ${s.vrate > 0 ? 'climbing' : 'descending'} ${Math.abs(Math.round(s.vrate / 100) * 100)} fpm` : '';
  const gs = s.gs ? `, ${Math.round(s.gs)} kt` : '';
  return `${alt}${vs}${gs}${agl !== undefined && agl < 5000 && !s.onGround ? ` · ${Math.round(agl / 50) * 50} ft above the field` : ''}. Tap to follow.`;
}
