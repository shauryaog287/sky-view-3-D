import { Cartesian3, Math as CesiumMath } from 'cesium';
import type { AircraftState } from '../../shared/types';
import { getScene } from '../scene/controller';
import { aircraftStore, nowMs } from './aircraftStore';
import { cameraMode, followHex, pinnedHexes, selectedHex, type CameraMode } from './selection';
import { canUseFeature, maxPinned, upsellFor } from './entitlements';
import { toast } from './store';
import { ensureFlightInfo } from './flightInfo';

/** Feature gate for each camera mode. */
export const CAMERA_FEATURE = {
  free: 'live_globe',
  orbit: 'follow_cam',
  chase: 'follow_cam',
  cockpit: 'cockpit_cam',
  tower: 'tower_cam',
  runway: 'tower_cam',
} as const;

export function selectAircraft(hex: string | null) {
  selectedHex.value = hex;
  const a = aircraftStore.get(hex);
  if (a) ensureFlightInfo(a.hex, a.state.callsign);
}

/** Make sure an aircraft from search results is in the store, then select it and fly the camera there. */
export function showAircraft(state: AircraftState) {
  aircraftStore.ingest([state]);
  selectAircraft(state.hex);
  const scene = getScene();
  if (!scene) return;
  const a = aircraftStore.get(state.hex);
  const pose = a?.motion.sample(nowMs());
  if (!pose) return;
  scene.viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(pose.lon, pose.lat - 0.25, Math.max(25_000, (pose.altFt ?? 0) * 0.3048 + 22_000)),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-55), roll: 0 },
    duration: 1.8,
  });
}

export function follow(hex: string, mode: Exclude<CameraMode, 'free'>) {
  const feature = CAMERA_FEATURE[mode];
  if (!canUseFeature(feature)) {
    upsellFor.value = feature;
    return;
  }
  const scene = getScene();
  if (!scene) return;
  if ((mode === 'tower' || mode === 'runway') && !scene.prepareGroundCamera(hex, mode)) {
    toast('Tower and runway cameras work when the flight is near an airport (approach or departure).', 'warn', 5000);
    return;
  }
  selectAircraft(hex);
  followHex.value = hex;
  cameraMode.value = mode;
  scene.cameras.follow(hex, mode, nowMs());
}

export function stopFollow() {
  followHex.value = null;
  cameraMode.value = 'free';
  getScene()?.cameras.stop();
}

export function togglePin(hex: string) {
  const cur = pinnedHexes.value;
  if (cur.includes(hex)) {
    pinnedHexes.value = cur.filter((h) => h !== hex);
    return;
  }
  if (cur.length >= maxPinned.value) {
    if (!canUseFeature('multi_follow')) upsellFor.value = 'multi_follow';
    else toast(`You can pin up to ${maxPinned.value} flights.`, 'warn');
    return;
  }
  pinnedHexes.value = [...cur, hex];
}
