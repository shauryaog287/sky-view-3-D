import { aircraftStore } from '../state/aircraftStore';
import { followHex, pinnedHexes, selectedHex, cameraMode } from '../state/selection';
import { follow, selectAircraft, togglePin } from '../state/actions';

/** Quick switcher for pinned flights (1 free, up to 4 with multi-follow). */
export function PinnedBar() {
  const pins = pinnedHexes.value;
  aircraftStore.version.value;
  if (!pins.length) return null;
  return (
    <nav class="pinned" aria-label="Pinned flights">
      {pins.map((hex) => {
        const a = aircraftStore.get(hex);
        const label = a?.state.callsign ?? a?.state.reg ?? hex.toUpperCase();
        const active = selectedHex.value === hex;
        return (
          <span key={hex} class={`pin-chip ${active ? 'on' : ''}`}>
            <button
              onClick={() => {
                if (followHex.value) follow(hex, cameraMode.value === 'free' ? 'chase' : (cameraMode.value as 'chase'));
                else selectAircraft(hex);
              }}
              class="num"
            >
              {label}
            </button>
            <button aria-label={`Unpin ${label}`} class="x" onClick={() => togglePin(hex)}>
              ×
            </button>
          </span>
        );
      })}
    </nav>
  );
}
