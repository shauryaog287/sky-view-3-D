import { useEffect, useState } from 'preact/hooks';
import { aircraftStore, nowMs } from '../state/aircraftStore';
import { cameraMode, followHex, pinnedHexes, selectedHex, uiTick } from '../state/selection';
import { flightInfo, ensureFlightInfo } from '../state/flightInfo';
import { useFeature } from '../state/entitlements';
import { follow, selectAircraft, stopFollow, togglePin } from '../state/actions';
import { flightPhases, PHASE_LABEL } from '../state/phases';
import { isAirportPhase } from '../../shared/phase';
import { openReplay, replay } from '../state/replay';
import { openAlertSheet } from '../state/alerts';
import { flightNumberFromCallsign, airlineFromCallsign } from '../../shared/airlines';
import { fmtAge, fmtAlt, fmtAltFeet, fmtHeading, fmtKmh, fmtSpeed, fmtVs, freshness } from '../lib/format';
import type { FlightInfo, WeatherInfo } from '../../shared/types';
import { focusWeather } from '../state/weather';

export function InfoPanel() {
  const hex = selectedHex.value;
  const [expanded, setExpanded] = useState(false);
  uiTick.value; // re-render 4×/s for live values and data age
  const a = aircraftStore.get(hex);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedHex.value) {
        if (followHex.value) stopFollow();
        else selectAircraft(null);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  if (!hex || replay.value) return null;
  if (!a) {
    return (
      <aside class="panel info-panel" aria-label="Flight details">
        <div class="panel-head">
          <h2 class="callsign num">{hex.toUpperCase()}</h2>
          <button class="icon-btn small" aria-label="Close" onClick={() => selectAircraft(null)}>
            ✕
          </button>
        </div>
        <p class="muted">This flight is no longer reported by our data sources.</p>
      </aside>
    );
  }

  const s = a.state;
  ensureFlightInfo(a.hex, s.callsign);
  const now = nowMs();
  const pose = a.motion.sample(now);
  const ageMs = now - a.motion.lastFixTime;
  const fresh = freshness(ageMs);
  const infoRaw = flightInfo.value[a.hex];
  const info: FlightInfo | undefined = typeof infoRaw === 'object' ? infoRaw : undefined;
  const flightNo = flightNumberFromCallsign(s.callsign);
  const airline = info?.airline?.name ?? airlineFromCallsign(s.callsign)?.name;
  const phase = flightPhases.value[a.hex];
  const following = followHex.value === a.hex;
  const pinned = pinnedHexes.value.includes(a.hex);

  return (
    <aside
      class={`panel info-panel ${following ? 'following' : ''} ${expanded ? 'expanded' : ''}`}
      aria-label={`Flight details for ${s.callsign ?? a.hex}`}
      data-testid="info-panel"
    >
      <div class="panel-head">
        <div>
          <h2 class="callsign num" data-testid="info-callsign">
            {s.callsign ?? s.reg ?? a.hex.toUpperCase()}
          </h2>
          <div class="subtle">
            {[flightNo, airline].filter(Boolean).join(' · ') || 'Unknown operator'}
          </div>
        </div>
        <div class="head-actions">
          <button class={`icon-btn small ${pinned ? 'on' : ''}`} aria-pressed={pinned} aria-label={pinned ? 'Unpin flight' : 'Pin flight'} onClick={() => togglePin(a.hex)}>
            📌
          </button>
          <button class="icon-btn small" aria-label="Close" onClick={() => (following ? stopFollow() : selectAircraft(null))}>
            ✕
          </button>
        </div>
      </div>

      <Route info={info} loading={infoRaw === 'loading'} />

      <div class="chips">
        {phase && <span class={`chip phase-${phase}`}>{PHASE_LABEL[phase]}</span>}
        <span class={`chip fresh-${fresh}`} title="Positions between updates are estimated from speed, track and climb rate" data-testid="data-age">
          <span class="dot" aria-hidden="true" />
          {fresh === 'live' ? 'Live' : fresh === 'estimated' ? 'Estimated' : 'Stale'} · {fmtAge(ageMs)} old
        </span>
        {s.squawk && ['7500', '7600', '7700'].includes(s.squawk) && <span class="chip danger">Squawk {s.squawk}</span>}
        {focusWeather.value?.key === a.hex && <WeatherChip w={focusWeather.value.info} />}
      </div>

      <dl class="readouts">
        <Readout label="Altitude" value={fmtAlt(pose.altFt)} sub={pose.altFt !== null && pose.altFt >= 18000 ? fmtAltFeet(pose.altFt) : undefined} />
        <Readout label="Vertical" value={fmtVs(s.onGround ? 0 : pose.vrateFpm)} />
        <Readout label="Speed" value={fmtSpeed(s.gs)} sub={fmtKmh(s.gs)} />
        <Readout label="Track" value={fmtHeading(pose.heading)} />
        <Readout label="Aircraft" value={s.type ?? info?.aircraft?.icaoType ?? '—'} sub={info?.aircraft?.type ?? info?.aircraft?.manufacturer} />
        <Readout label="Registration" value={s.reg ?? info?.aircraft?.reg ?? '—'} />
        <Readout label="Squawk" value={s.squawk ?? '—'} />
        <Readout label="ICAO hex" value={a.hex.toUpperCase()} sub={`via ${sourceLabel(s.source)}${s.mlat ? ' (MLAT)' : ''}`} />
      </dl>

      <CameraButtons hex={a.hex} following={following} suggestGround={isAirportPhase(phase)} />
      {following && (
        <button class="details-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Less ▴' : 'Details ▾'}
        </button>
      )}

      <div class="action-row">
        <FeatureButton id="replay" label="Replay" icon="⏪" onClick={() => openReplay(a.hex)} />
        <FeatureButton id="alerts" label="Alert me" icon="🔔" onClick={() => openAlertSheet(a.hex)} />
      </div>
      {info?.source && info.source !== 'Sample data' && (
        <p class="fineprint">Route & airframe from {info.source}; schedules can be wrong for ad-hoc flights.</p>
      )}
    </aside>
  );
}

function Route({ info, loading }: { info?: FlightInfo; loading: boolean }) {
  if (loading) return <div class="route muted">Loading route…</div>;
  if (!info?.origin && !info?.destination) return <div class="route muted">Route not available</div>;
  const o = info.origin;
  const d = info.destination;
  return (
    <div class="route" data-testid="route">
      <div class="ap">
        <div class="code num">{o?.iata ?? o?.icao ?? '???'}</div>
        <div class="city">{o?.city ?? o?.name ?? ''}</div>
      </div>
      <div class="arrow" aria-hidden="true">
        ✈
      </div>
      <div class="ap right">
        <div class="code num">{d?.iata ?? d?.icao ?? '???'}</div>
        <div class="city">{d?.city ?? d?.name ?? ''}</div>
      </div>
    </div>
  );
}

function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div class="readout">
      <dt>{label}</dt>
      <dd class="num">{value}</dd>
      {sub && <dd class="sub">{sub}</dd>}
    </div>
  );
}

function CameraButtons({ hex, following, suggestGround }: { hex: string; following: boolean; suggestGround: boolean }) {
  const mode = cameraMode.value;
  const btn = (m: 'orbit' | 'chase' | 'cockpit' | 'tower' | 'runway', label: string, feature: Parameters<typeof useFeature>[0]) => {
    const f = useFeature(feature);
    const active = following && mode === m;
    return (
      <button
        class={`seg ${active ? 'on' : ''} ${suggestGround && (m === 'tower' || m === 'runway') && !active ? 'suggest' : ''}`}
        aria-pressed={active}
        onClick={() => f.run(() => follow(hex, m))}
        data-testid={`cam-${m}`}
      >
        {label}
        {!f.allowed && <span class="lock" aria-label="Pro feature"> 🔒</span>}
      </button>
    );
  };
  return (
    <div class="camera-buttons" role="group" aria-label="Camera">
      {btn('chase', 'Chase', 'follow_cam')}
      {btn('orbit', 'Orbit', 'follow_cam')}
      {btn('cockpit', 'Cockpit', 'cockpit_cam')}
      {btn('tower', 'Tower', 'tower_cam')}
      {btn('runway', 'Runway', 'tower_cam')}
      {following && (
        <button class="seg stop" onClick={stopFollow} data-testid="cam-stop">
          Stop
        </button>
      )}
    </div>
  );
}

function FeatureButton({ id, label, icon, onClick }: { id: 'replay' | 'alerts'; label: string; icon: string; onClick: () => void }) {
  const f = useFeature(id);
  return (
    <button class="btn" onClick={() => f.run(onClick)} data-testid={`btn-${id}`}>
      <span aria-hidden="true">{icon}</span> {label}
      {!f.allowed && <span class="lock" aria-label="Pro feature"> 🔒</span>}
    </button>
  );
}

function sourceLabel(id: string) {
  return { adsblol: 'adsb.lol', airplaneslive: 'airplanes.live', opensky: 'OpenSky', commercial: 'licensed feed', fixture: 'sample data' }[id] ?? id;
}

function WeatherChip({ w }: { w: WeatherInfo }) {
  const m = w.metar;
  const layer = m?.clouds[0];
  const vis = w.visibilityM;
  const parts = [
    layer ? `${layer.cover} ${layer.baseFt.toLocaleString('en-US')} ft` : w.cloudCover !== undefined ? `Cloud ${Math.round(w.cloudCover)}%` : undefined,
    vis !== undefined ? `Vis ${vis >= 10_000 ? '10+ km' : vis >= 1000 ? `${(vis / 1000).toFixed(1)} km` : `${Math.round(vis / 50) * 50} m`}` : undefined,
    m?.wx,
    m?.station,
  ].filter(Boolean);
  return (
    <span class="chip" title={m?.raw ?? w.sources.join(', ')} data-testid="weather-chip">
      ☁ {parts.join(' · ')}
    </span>
  );
}
