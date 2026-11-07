import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { alertSheetFor, myAlerts, refreshAlerts } from '../state/alerts';
import { aircraftStore } from '../state/aircraftStore';
import { flightInfo } from '../state/flightInfo';
import { appConfig } from '../state/entitlements';
import { api } from '../api';
import { toast } from '../state/store';
import { pushSupport, subscribePush } from '../lib/push';
import { env } from '../config/env';
import { flightNumberFromCallsign } from '../../shared/airlines';
import { CONDITION_LABEL } from '../../shared/alertRules';
import type { AlertCondition } from '../../shared/apiTypes';
import { fmtTime } from '../lib/format';

const CONDITIONS: AlertCondition[] = ['takeoff', 'descent', 'approach', 'landed'];

/** "Tell me when 6E 2134 starts descending into DEL". */
export function AlertSheet() {
  const hex = alertSheetFor.value;
  const [condition, setCondition] = useState<AlertCondition>('descent');
  const [airport, setAirport] = useState<string | undefined>(undefined);
  const [wantPush, setWantPush] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!hex) return null;
  const a = aircraftStore.get(hex);
  const info = flightInfo.value[hex];
  const dest = typeof info === 'object' ? (info.destination?.iata ?? info.destination?.icao) : undefined;
  const cs = a?.state.callsign;
  const label = (cs && flightNumberFromCallsign(cs)) ?? cs ?? a?.state.reg ?? hex.toUpperCase();
  const vapid = appConfig.value?.vapidPublicKey ?? env.vapidPublicKey;
  const support = api.mode === 'mock' ? 'no-key' : pushSupport(vapid);
  const ap = airport ?? (condition === 'takeoff' ? '' : (dest ?? ''));
  const close = () => (alertSheetFor.value = null);

  const create = async () => {
    setBusy(true);
    try {
      let push;
      if (wantPush && support === 'supported' && vapid) push = await subscribePush(vapid).catch(() => undefined);
      const keys = push?.keys as { p256dh: string; auth: string } | undefined;
      await api.createAlert({
        hex,
        callsign: cs,
        label,
        condition,
        airport: ap.trim() || undefined,
        push: push?.endpoint && keys ? { endpoint: push.endpoint, keys } : undefined,
      });
      toast(`Alert set: ${label} ${CONDITION_LABEL[condition]}${ap ? ` (${ap.toUpperCase()})` : ''}.${push ? '' : ' You will be notified while SkyView is open.'}`);
      await refreshAlerts();
      close();
    } catch (e) {
      toast((e as Error).message || 'Could not create the alert', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Alert for ${label}`} onClose={close} testId="alert-sheet">
      <fieldset class="field">
        <legend>Tell me when it…</legend>
        <div class="choice-list" role="radiogroup">
          {CONDITIONS.map((c) => (
            <label key={c} class={`choice ${condition === c ? 'on' : ''}`}>
              <input type="radio" name="cond" checked={condition === c} onChange={() => setCondition(c)} />
              {CONDITION_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      {condition !== 'takeoff' && (
        <label class="field text-field">
          <span>Into airport (optional)</span>
          <input
            value={ap}
            maxLength={4}
            placeholder="e.g. DEL"
            autoCapitalize="characters"
            onInput={(e) => setAirport((e.target as HTMLInputElement).value.toUpperCase())}
            data-testid="alert-airport"
          />
          <span class="hint">IATA or ICAO code. Leave empty for any airport.</span>
        </label>
      )}
      <label class="toggle">
        <span>
          <span class="toggle-label">Push notification</span>
          <span class="hint">
            {support === 'supported' && 'Works even when SkyView is closed (the browser will ask for permission).'}
            {support === 'denied' && 'Notifications are blocked for this site in your browser settings.'}
            {support === 'unsupported' && 'This browser does not support push. Install SkyView to your home screen for push.'}
            {support === 'no-key' && 'Push is not configured on this server yet — you will be alerted while the app is open.'}
          </span>
        </span>
        <input type="checkbox" role="switch" disabled={support !== 'supported'} checked={wantPush && support === 'supported'} onChange={(e) => setWantPush((e.target as HTMLInputElement).checked)} />
      </label>
      <button class="btn primary wide" disabled={busy} onClick={create} data-testid="alert-create">
        {busy ? 'Setting alert…' : 'Set alert'}
      </button>
      {myAlerts.value.length > 0 && (
        <div class="alert-list">
          <h3>Your alerts</h3>
          {myAlerts.value.map((al) => (
            <div key={al.id} class={`alert-row ${al.active ? '' : 'done'}`}>
              <span>
                <strong>{al.label}</strong> {CONDITION_LABEL[al.condition]}
                {al.airport ? ` (${al.airport})` : ''}
                <span class="hint">
                  {al.firedAt ? `Fired ${fmtTime(al.firedAt)}` : al.active ? `Active until ${fmtTime(al.expiresAt)}` : 'Expired'}
                  {al.push ? ' · push' : ' · in-app'}
                </span>
              </span>
              <button
                class="icon-btn small"
                aria-label={`Delete alert for ${al.label}`}
                onClick={async () => {
                  await api.deleteAlert(al.id).catch(() => undefined);
                  await refreshAlerts();
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
