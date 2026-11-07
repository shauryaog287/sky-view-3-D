import { signal } from '@preact/signals';

export interface ReplayState {
  hex: string;
  status: 'loading' | 'ready' | 'empty' | 'error';
  error?: string;
  start?: number;
  end?: number;
  points?: number;
}

/** Active replay session (one at a time). The ReplayBar reads this; the scene's ReplayController drives it. */
export const replay = signal<ReplayState | null>(null);
export const replayClock = signal<{ t: number; playing: boolean; speed: number }>({ t: 0, playing: false, speed: 8 });

export function openReplay(hex: string) {
  replay.value = { hex, status: 'loading' };
}

export function closeReplay() {
  replay.value = null;
}
