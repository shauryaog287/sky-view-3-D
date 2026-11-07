import type { Viewer } from 'cesium';
import { createViewer } from './viewer';
import { BaseLayers } from './baseLayers';
import { env } from '../config/env';
import { baseLayerStatus } from '../state/store';

/**
 * Owns the Cesium scene and every scene subsystem. One instance per page load.
 * UI code talks to the scene only through this controller.
 */
export class SceneController {
  readonly viewer: Viewer;
  readonly baseLayers: BaseLayers;

  constructor(container: HTMLElement) {
    this.viewer = createViewer({ container });
    this.baseLayers = new BaseLayers(this.viewer);
    this.baseLayers.onChange((s) => (baseLayerStatus.value = s));
  }

  async start() {
    await this.baseLayers.init({
      allowed: false,
      deniedReason: 'Photorealistic tiles not configured yet',
      ionToken: env.cesiumIonToken,
    });
  }

  destroy() {
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}

let current: SceneController | null = null;
export function getScene(): SceneController | null {
  return current;
}
export function setScene(s: SceneController | null) {
  current = s;
  if (env.isDev || env.apiMode === 'mock') {
    (window as unknown as { __skyview?: unknown }).__skyview = s;
  }
}
