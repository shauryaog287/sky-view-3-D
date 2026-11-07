import { alertTriggered, CONDITION_LABEL } from '../../shared/alertRules';
import type { AlertRecord } from '../../shared/apiTypes';
import type { FlightPhase } from '../../shared/types';
import type { PhaseTracker, TrackedPhase } from './phaseTracker';
import { myAlerts, refreshAlerts } from '../state/alerts';
import { flightInfo } from '../state/flightInfo';
import { aircraftStore } from '../state/aircraftStore';
import { api } from '../api';
import { toast } from '../state/store';
import { notify } from '../lib/push';

/**
 * In-app alert evaluation for alerts without Web Push (mock mode, push not configured or not granted).
 * Keeps those flights in the feed by looking them up once a minute, and fires on phase transitions.
 * Alerts with push are evaluated by the Worker cron instead (no double notifications).
 */
export class AlertMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private readonly off: () => void;
  private readonly fired = new Set<string>();

  constructor(private readonly phases: PhaseTracker) {
    this.off = phases.onPhaseChange((hex, prev, next, t) => this.onPhase(hex, prev, next, t));
  }

  start() {
    void refreshAlerts();
    this.timer = setInterval(() => void this.refreshTargets(), 60_000);
    setTimeout(() => void this.refreshTargets(), 5000);
  }

  private local(): AlertRecord[] {
    return myAlerts.value.filter((a) => a.active && !a.push && !this.fired.has(a.id) && a.expiresAt > Date.now());
  }

  /** Make sure aircraft with in-app alerts stay in the store even when they are off-screen. */
  private async refreshTargets() {
    for (const al of this.local()) {
      const q = al.callsign ?? al.hex;
      if (!q) continue;
      const r = await api.search(q).catch(() => undefined);
      const hit = r?.aircraft.find((x) => x.hex === al.hex) ?? r?.aircraft[0];
      if (hit) {
        aircraftStore.ingest([hit]);
        aircraftStore.pinned.add(hit.hex);
      }
    }
    this.phases.tick();
  }

  private onPhase(hex: string, prev: FlightPhase | undefined, next: FlightPhase, t: TrackedPhase) {
    const a = aircraftStore.get(hex);
    for (const al of this.local()) {
      if (al.hex !== hex && !(al.callsign && al.callsign === a?.state.callsign)) continue;
      let airportMatch: boolean | undefined;
      if (al.airport) {
        const code = al.airport.toUpperCase();
        const info = flightInfo.value[hex];
        const dest = typeof info === 'object' ? info.destination : undefined;
        const rwy = t.runway && t.runway.distToEndM < 30_000 ? t.runway.airport : undefined;
        const matches = (x?: { icao?: string; iata?: string; ident?: string }) =>
          !!x && [x.icao, x.iata, x.ident].some((c) => c?.toUpperCase() === code);
        if (matches(dest) || matches(rwy)) airportMatch = true;
        else if (dest?.icao) airportMatch = false;
      }
      if (alertTriggered(al.condition, prev, next, { airportMatch, aglFt: t.aglFt, onGround: a?.state.onGround })) {
        this.fired.add(al.id);
        const title = `${al.label} ${CONDITION_LABEL[al.condition]}${al.airport ? ` (${al.airport})` : ''}`;
        toast(`🔔 ${title}`, 'info', 8000);
        void notify(title, 'Tap to follow the flight.', `/?follow=${encodeURIComponent(hex)}`);
        void api.deleteAlert(al.id).then(refreshAlerts, () => undefined);
      }
    }
  }

  stop() {
    clearInterval(this.timer);
    this.off();
  }
}
