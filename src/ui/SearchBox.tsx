import { useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { aircraftStore } from '../state/aircraftStore';
import { showAircraft } from '../state/actions';
import { matchesPlan, planSearch } from '../../shared/search';
import type { AircraftState } from '../../shared/types';
import { fmtAlt } from '../lib/format';
import { flightNumberFromCallsign } from '../../shared/airlines';
import { featureUsage } from '../state/entitlements';

/** Search by flight number (6E 2134), callsign (IGO2134), registration (VT-NHC) or ICAO hex. */
export function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<AircraftState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const plan = q.trim().length >= 2 ? planSearch(q) : undefined;
  const local = plan ? [...aircraftStore.map.values()].map((a) => a.state).filter((s) => matchesPlan(s, plan)).slice(0, 8) : [];
  const results = dedupe([...local, ...(remote ?? [])]);

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!plan) return;
    featureUsage.track('flight_search', 'use');
    if (local.length === 1) {
      pick(local[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.search(q);
      setRemote(r.aircraft);
      const all = dedupe([...local, ...r.aircraft]);
      if (all.length === 1) pick(all[0]);
      else if (!r.aircraft.length && !local.length) setError(`No live flight found for “${q.trim()}”. It may not be airborne or not covered right now.`);
    } catch (err) {
      setError((err as Error).message || 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  const pick = (s: AircraftState) => {
    showAircraft(s);
    setOpen(false);
    input.current?.blur();
  };

  return (
    <form class="search" role="search" onSubmit={submit} data-testid="search">
      <label class="sr-only" for="flight-search">
        Search flights
      </label>
      <span class="search-icon" aria-hidden="true">
        ⌕
      </span>
      <input
        id="flight-search"
        ref={input}
        type="search"
        inputMode="search"
        autoComplete="off"
        autoCapitalize="characters"
        spellcheck={false}
        placeholder="Flight, callsign or reg — e.g. 6E 2134"
        value={q}
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setRemote(null);
          setError(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {busy && <span class="spinner" aria-label="Searching" />}
      {open && plan && (
        <ul class="search-results" role="listbox" aria-label="Search results">
          {results.map((s) => (
            <li key={s.hex} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                <span class="num strong">{s.callsign ?? s.reg ?? s.hex.toUpperCase()}</span>
                <span class="muted">
                  {[flightNumberFromCallsign(s.callsign), s.type, s.reg].filter(Boolean).join(' · ')}
                </span>
                <span class="num right">{fmtAlt(s.onGround ? null : (s.altBaro ?? s.altGeom))}</span>
              </button>
            </li>
          ))}
          {!results.length && !busy && !error && (
            <li class="hint">
              Press Enter to search live flights{plan.callsigns[0] ? ` (callsign ${plan.callsigns[0]})` : ''}
            </li>
          )}
          {error && <li class="hint warn">{error}</li>}
        </ul>
      )}
    </form>
  );
}

function dedupe(list: AircraftState[]) {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.hex) ? false : (seen.add(a.hex), true)));
}
