import { Sheet } from './Sheet';
import { analyticsOptOut, photoreal, quality, settingsOpen, showLabels, weatherOn } from '../state/settings';
import { QUALITY, type QualityLevel } from '../config/quality';
import { useFeature, launchMode } from '../state/entitlements';
import { baseLayerStatus } from '../state/store';
import { accountOpen } from '../state/account';
import { legalPage } from '../state/legal';
import { api } from '../api';
import { readPref, writePref } from '../lib/device';
import { loadConfigAndEntitlements } from '../state/bootstrap';
import { installAvailable, isIos, isStandalone, promptInstall } from '../lib/install';

export function SettingsSheet() {
  if (!settingsOpen.value) return null;
  const high = useFeature('quality_high');
  const weather = useFeature('weather_effects');
  const pickQuality = (q: QualityLevel) => {
    if (q === 'high') high.run(() => (quality.value = 'high'));
    else quality.value = q;
  };
  const layer = baseLayerStatus.value;
  return (
    <Sheet title="Settings" onClose={() => (settingsOpen.value = false)} testId="settings">
      <fieldset class="field">
        <legend>Graphics quality</legend>
        <div class="seg-row" role="radiogroup" aria-label="Graphics quality">
          {(Object.keys(QUALITY) as QualityLevel[]).map((q) => (
            <button
              key={q}
              role="radio"
              aria-checked={quality.value === q}
              class={`seg ${quality.value === q ? 'on' : ''}`}
              onClick={() => pickQuality(q)}
              data-testid={`quality-${q}`}
            >
              {q[0].toUpperCase() + q.slice(1)}
              {q === 'high' && !high.allowed && <span class="lock"> 🔒</span>}
            </button>
          ))}
        </div>
        <p class="hint">{QUALITY[quality.value].label}. Low saves battery on phones; High adds shadows, more 3D aircraft and finer tiles.</p>
      </fieldset>

      <Toggle
        label="Photorealistic 3D world"
        hint={`Google Photorealistic 3D Tiles when available (uses more data). Now: ${layer.kind === 'google3d' ? 'on' : `off — ${layer.reason ?? 'not available'}`}. Applies after reload.`}
        checked={photoreal.value}
        onChange={(v) => (photoreal.value = v)}
      />
      <Toggle
        label="Live weather & clouds"
        hint="Clouds, visibility and haze from METAR / Open-Meteo near the followed flight."
        checked={weatherOn.value && weather.allowed}
        locked={!weather.allowed}
        onChange={(v) => weather.run(() => (weatherOn.value = v))}
      />
      <Toggle label="Aircraft labels" hint="Callsign and altitude next to nearby aircraft." checked={showLabels.value} onChange={(v) => (showLabels.value = v)} />
      <Toggle
        label="Share anonymous usage stats"
        hint="Counts which features are used (no account, no location, no IP). Helps decide what to build."
        checked={!analyticsOptOut.value}
        onChange={(v) => (analyticsOptOut.value = !v)}
      />

      {api.mode === 'mock' && (
        <Toggle
          label="Demo: simulate freemium (paywall on)"
          hint="Mock mode only. Shows how Pro features lock and the upsell / test checkout flow works."
          checked={readPref<string>('mock_launch_mode', 'open') === 'freemium'}
          onChange={(v) => {
            writePref('mock_launch_mode', v ? 'freemium' : 'open');
            void loadConfigAndEntitlements();
          }}
        />
      )}

      <div class="link-list">
        {installAvailable.value && (
          <button class="btn primary" onClick={() => void promptInstall()} data-testid="install-app">
            Install SkyView 3D app
          </button>
        )}
        {!installAvailable.value && !isStandalone.value && isIos() && (
          <p class="hint">To install on iPhone/iPad: tap Share, then “Add to Home Screen”.</p>
        )}
        <button class="btn" onClick={() => ((settingsOpen.value = false), (accountOpen.value = true))} data-testid="open-account">
          Account & subscription
        </button>
        <button class="linkish" onClick={() => (legalPage.value = 'sources')}>
          Data sources & attribution
        </button>
        <button class="linkish" onClick={() => (legalPage.value = 'privacy')}>
          Privacy policy
        </button>
        <button class="linkish" onClick={() => (legalPage.value = 'terms')}>
          Terms of use
        </button>
      </div>
      <p class="fineprint">
        SkyView 3D {__APP_VERSION__} · {launchMode.value === 'open' ? 'All features free during launch' : 'Freemium'} · Positions between updates
        are estimated. Not for navigation.
      </p>
    </Sheet>
  );
}

function Toggle(p: { label: string; hint?: string; checked: boolean; locked?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="toggle">
      <span>
        <span class="toggle-label">
          {p.label}
          {p.locked && <span class="lock"> 🔒</span>}
        </span>
        {p.hint && <span class="hint">{p.hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={p.checked} onChange={(e) => p.onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}
