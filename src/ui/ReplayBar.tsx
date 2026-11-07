import { replay, replayClock, closeReplay } from '../state/replay';
import { uiTick } from '../state/selection';
import { getScene } from '../scene/controller';
import { aircraftStore } from '../state/aircraftStore';
import { fmtAlt, fmtSpeed, fmtTime } from '../lib/format';
import { REPLAY_PREFIX } from '../scene/replay';

const SPEEDS = [1, 4, 8, 16, 60];

/** Playback controls for flight replay (last ~60 minutes from stored track points). */
export function ReplayBar() {
  const r = replay.value;
  uiTick.value;
  if (!r) return null;
  const scene = getScene();
  const label = aircraftStore.get(r.hex)?.state.callsign ?? r.hex.toUpperCase();
  if (r.status !== 'ready' || r.start === undefined || r.end === undefined) {
    return (
      <div class="replay-bar" role="region" aria-label="Replay" data-testid="replay-bar">
        <div class="replay-msg">
          {r.status === 'loading' && `Loading the last 60 minutes of ${label}…`}
          {r.status === 'empty' &&
            `No recorded track for ${label} yet. SkyView stores tracks for flights people are viewing (up to 2 hours); try again in a few minutes.`}
          {r.status === 'error' && `Couldn't load the replay: ${r.error ?? 'server error'}`}
        </div>
        <button class="btn" onClick={closeReplay}>
          Close
        </button>
      </div>
    );
  }
  const c = replayClock.value;
  const t = scene?.replay.clock() ?? c.t;
  const pose = aircraftStore.get(REPLAY_PREFIX + r.hex)?.motion.sample(t);
  const span = r.end - r.start;
  const behind = Math.round((r.end - t) / 60_000);
  return (
    <div class="replay-bar" role="region" aria-label={`Replay of ${label}`} data-testid="replay-bar">
      <div class="replay-top">
        <strong class="num">⏪ {label}</strong>
        <span class="num muted">
          {fmtTime(t)} · {behind > 0 ? `${behind} min before latest` : 'latest'} · {fmtAlt(pose?.altFt)} · {fmtSpeed(pose?.gsKt)}
        </span>
        <button class="icon-btn small" aria-label="Exit replay" onClick={closeReplay} data-testid="replay-exit">
          ✕
        </button>
      </div>
      <div class="replay-controls">
        <button
          class="icon-btn small"
          aria-label={c.playing ? 'Pause' : 'Play'}
          onClick={() => scene?.replay.control({ playing: !c.playing })}
          data-testid="replay-play"
        >
          {c.playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(((t - r.start) / span) * 1000)}
          aria-label="Replay position"
          onInput={(e) => scene?.replay.control({ t: r.start! + (Number((e.target as HTMLInputElement).value) / 1000) * span })}
          class="scrubber"
        />
        <div class="speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} class={`seg ${c.speed === s ? 'on' : ''}`} aria-pressed={c.speed === s} onClick={() => scene?.replay.control({ speed: s })}>
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
