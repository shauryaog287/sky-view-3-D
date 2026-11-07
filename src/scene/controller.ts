import { ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer, type Cartesian2 } from 'cesium';
import { effect } from '@preact/signals';
import { createViewer } from './viewer';
import { BaseLayers } from './baseLayers';
import { AircraftLayer } from './aircraftLayer';
import { LiveFeed } from './liveFeed';
import { ModelPool } from './modelPool';
import { CameraRig } from './cameras';
import { env } from '../config/env';
import { baseLayerStatus } from '../state/store';
import { aircraftStore, nowMs } from '../state/aircraftStore';
import { cameraMode, followHex, selectedHex } from '../state/selection';
import { toast } from '../state/store';

/**
 * Owns the Cesium scene and every scene subsystem. One instance per page load.
 * UI code talks to the scene only through this controller and the shared signals.
 */
export class SceneController {
  readonly viewer: Viewer;
  readonly baseLayers: BaseLayers;
  readonly aircraft: AircraftLayer;
  readonly feed: LiveFeed;
  readonly cameras: CameraRig;
  private readonly disposers: (() => void)[] = [];
  private handler?: ScreenSpaceEventHandler;

  constructor(container: HTMLElement) {
    this.viewer = createViewer({ container });
    this.baseLayers = new BaseLayers(this.viewer);
    this.baseLayers.onChange((s) => (baseLayerStatus.value = s));
    this.aircraft = new AircraftLayer(this.viewer, aircraftStore);
    this.aircraft.models = new ModelPool(this.viewer.scene);
    this.feed = new LiveFeed(this.viewer);
    this.cameras = new CameraRig(this.viewer, this.aircraft);

    const pre = () => {
      const now = nowMs();
      this.aircraft.update(now);
      if (!this.cameras.update(now)) {
        // The followed aircraft disappeared from the feed (landed and stopped reporting, or out of coverage).
        followHex.value = null;
        cameraMode.value = 'free';
        this.cameras.stop();
        toast('Lost contact with the followed flight.', 'warn');
      }
    };
    this.viewer.scene.preRender.addEventListener(pre);
    this.disposers.push(() => this.viewer.scene.preRender.removeEventListener(pre));

    this.disposers.push(
      effect(() => {
        this.aircraft.selected = selectedHex.value;
        this.aircraft.followed = followHex.value;
        aircraftStore.pinned.clear();
        if (selectedHex.value) aircraftStore.pinned.add(selectedHex.value);
        if (followHex.value) aircraftStore.pinned.add(followHex.value);
      }),
    );

    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => {
      const hex = this.aircraft.pick(e.position);
      selectedHex.value = hex ?? null;
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  /** Set up the tower / runway-end camera for an aircraft near an airport. Implemented with airport presets (M4). */
  prepareGroundCamera(_hex: string, _mode: 'tower' | 'runway'): boolean {
    return false;
  }

  async start() {
    this.feed.start();
    await this.baseLayers.init({
      allowed: false,
      deniedReason: 'Photorealistic tiles not configured yet',
      ionToken: env.cesiumIonToken,
    });
  }

  destroy() {
    this.feed.stop();
    this.handler?.destroy();
    for (const d of this.disposers) d();
    this.aircraft.destroy();
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
    (window as unknown as { __skyview?: unknown }).__skyview = { scene: s, store: aircraftStore };
  }
}
