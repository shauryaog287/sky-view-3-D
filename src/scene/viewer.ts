import {
  Viewer,
  Ion,
  Cartesian3,
  Color,
  Math as CesiumMath,
  JulianDate,
  ClockStep,
  ShadowMode,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { env } from '../config/env';

export interface CreateViewerOptions {
  container: HTMLElement;
}

/**
 * Creates the Cesium viewer with every built-in widget disabled: the app draws its own UI.
 * The credit (attribution) container is kept and styled; it must stay visible at all times.
 */
export function createViewer({ container }: CreateViewerOptions): Viewer {
  if (env.cesiumIonToken) {
    Ion.defaultAccessToken = env.cesiumIonToken;
  } else {
    // Never fall back to Cesium's shared evaluation token in production builds.
    Ion.defaultAccessToken = '';
  }

  const viewer = new Viewer(container, {
    // Base layers are attached by BaseLayers so we control fallback order.
    baseLayer: false,
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    vrButton: false,
    projectionPicker: false,
    shouldAnimate: true,
    requestRenderMode: false,
    useBrowserRecommendedResolution: true,
    shadows: false,
    terrainShadows: ShadowMode.DISABLED,
    msaaSamples: 1,
    contextOptions: {
      webgl: {
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      },
    },
  });

  const { scene, clock } = viewer;
  // Real time: the sun position (and therefore lighting) follows the wall clock.
  clock.currentTime = JulianDate.now();
  clock.clockStep = ClockStep.SYSTEM_CLOCK;
  clock.shouldAnimate = true;

  scene.globe.baseColor = Color.fromCssColorString('#0b1a2a');
  scene.globe.enableLighting = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.backgroundColor = Color.BLACK;
  scene.highDynamicRange = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.screenSpaceCameraController.minimumZoomDistance = 15;
  scene.screenSpaceCameraController.maximumZoomDistance = 40_000_000;

  // Default view: India, where the curated airport presets are.
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(79.0, 21.5, 4_200_000),
    orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
  });

  return viewer;
}
