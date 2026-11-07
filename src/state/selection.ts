import { signal } from '@preact/signals';

export type CameraMode = 'free' | 'orbit' | 'chase' | 'cockpit' | 'tower' | 'runway';

/** Selected aircraft (info panel) and followed aircraft (camera). */
export const selectedHex = signal<string | null>(null);
export const followHex = signal<string | null>(null);
export const cameraMode = signal<CameraMode>('free');
/** Pinned flights for quick switching (multi-follow is a Pro feature). */
export const pinnedHexes = signal<string[]>([]);
/** 4 Hz UI clock so panels can show ticking data age without re-rendering every frame. */
export const uiTick = signal(0);
setInterval(() => (uiTick.value = (uiTick.value + 1) % 1_000_000), 250);
