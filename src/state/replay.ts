import { signal } from '@preact/signals';

export interface ReplayState {
  hex: string;
  status: 'loading' | 'ready' | 'empty' | 'error';
  error?: string;
}

/** Active replay session (one at a time). The ReplayBar and the scene's replay layer read this. */
export const replay = signal<ReplayState | null>(null);

export function openReplay(hex: string) {
  replay.value = { hex, status: 'loading' };
}

export function closeReplay() {
  replay.value = null;
}
