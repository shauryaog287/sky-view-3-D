import { describe, expect, it } from 'vitest';
import { evaluateAlerts } from '../src/alerts/evaluate';
import { MemoryAlertStore, type AlertRow } from '../src/alerts/store';
import { airportIndex } from '../../shared/airportData';
import { defaultScriptedFlights, scriptedState } from '../../shared/simulator';

const airports = airportIndex();
const arrival = defaultScriptedFlights(airports).find((f) => f.callsign === 'SKV101')!; // into VIDP 28

function row(o: Partial<AlertRow>): AlertRow {
  return {
    id: 'a1', device_id: 'dev', user_id: null, hex: arrival.hex, callsign: 'SKV101', label: 'SKV101', condition: 'landed',
    airport: null, push_sub: JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } }),
    last_phase: null, last_alt: null, created_at: 0, expires_at: Number.MAX_SAFE_INTEGER, fired_at: null, active: 1, ...o,
  };
}

/** Run the cron once a minute through one scripted arrival; return when (script seconds) each alert fired. */
async function runThrough(rows: AlertRow[], destination?: string) {
  const store = new MemoryAlertStore();
  for (const r of rows) await store.insert(r);
  const pushes: string[] = [];
  const start = (arrival.periodS - arrival.offsetS) * 1000;
  const firedAt: Record<string, number> = {};
  for (let s = 0; s < arrival.periodS; s += 20) {
    const t = start + s * 1000;
    const res = await evaluateAlerts({
      store,
      airports,
      now: t,
      lookup: async () => scriptedState(arrival, t),
      destination: async () => destination,
      push: async (_sub, p) => {
        pushes.push(p.title);
        return { gone: false };
      },
    });
    for (const id of res.fired) firedAt[id] = s;
  }
  return { firedAt, pushes, store };
}

describe('alert evaluation (cron)', () => {
  it('fires "descending into DEL", "on approach" and "landed" once each, in order, with a push', async () => {
    const { firedAt, pushes, store } = await runThrough([
      row({ id: 'desc', condition: 'descent', airport: 'DEL' }),
      row({ id: 'appr', condition: 'approach' }),
      row({ id: 'land', condition: 'landed' }),
      row({ id: 'tko', condition: 'takeoff' }),
    ]);
    expect(firedAt.desc).toBeDefined();
    expect(firedAt.appr).toBeGreaterThanOrEqual(firedAt.desc);
    expect(firedAt.land).toBeGreaterThan(firedAt.appr);
    expect(firedAt.tko).toBeUndefined();
    expect(pushes).toContain('SKV101 lands');
    expect(pushes.some((p) => p.startsWith('SKV101 starts descending (DEL)'))).toBe(true);
    expect(store.rows.find((r) => r.id === 'land')!.active).toBe(0);
  });

  it('does not fire for the wrong destination', async () => {
    const { firedAt } = await runThrough([row({ id: 'desc', condition: 'descent', airport: 'BOM' })], 'VIDP');
    expect(firedAt.desc).toBeUndefined();
  });

  it('expires old alerts', async () => {
    const store = new MemoryAlertStore();
    await store.insert(row({ id: 'old', expires_at: 10 }));
    await evaluateAlerts({ store, airports, now: 20, lookup: async () => undefined });
    expect(store.rows[0].active).toBe(0);
  });
});
