import { signal, computed } from '@preact/signals';
import type { BaseLayerStatus } from '../scene/baseLayers';

/** UI-facing application state. High-frequency data (aircraft positions) lives outside signals. */
export const baseLayerStatus = signal<BaseLayerStatus>({ kind: 'offline' });
export const sceneReady = signal(false);
export const webglError = signal<string | null>(null);

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
}
export const toasts = signal<Toast[]>([]);
let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'info', ms = 4000) {
  const t = { id: ++toastId, text, tone };
  toasts.value = [...toasts.value, t];
  setTimeout(() => {
    toasts.value = toasts.value.filter((x) => x.id !== t.id);
  }, ms);
}

export const isOfflineLayer = computed(() => baseLayerStatus.value.kind === 'offline');
