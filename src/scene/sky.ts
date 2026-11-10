import { sceneNowMs } from './sceneTime';
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  CloudCollection,
  Color,
  Math as CesiumMath,
  PostProcessStage,
  type Viewer,
} from 'cesium';
import type { WeatherInfo } from '../../shared/types';
import { destinationPoint, FT_TO_M, clamp } from '../../shared/geo';
import { skyTone, solarElevationDeg } from '../../shared/sun';
import type { BaseLayers } from './baseLayers';

/** Deterministic PRNG so a cloud field looks the same every time for the same place. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COVER_FRACTION: Record<string, number> = { FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1 };

export interface CloudLayer {
  cover: string;
  /** Base above ground, feet. */
  baseFt: number;
}

/** Pick the cloud layers to draw from METAR (preferred) or Open-Meteo cloud cover. */
export function cloudLayersFrom(w: WeatherInfo | null): CloudLayer[] {
  if (!w) return [];
  if (w.metar && w.metar.clouds.length) return w.metar.clouds.slice(0, 2).filter((c) => COVER_FRACTION[c.cover]);
  const out: CloudLayer[] = [];
  const code = (pct: number | undefined) => (pct === undefined || pct < 10 ? undefined : pct < 30 ? 'FEW' : pct < 55 ? 'SCT' : pct < 85 ? 'BKN' : 'OVC');
  const low = code(w.cloudLow);
  const mid = code(w.cloudMid);
  if (low) out.push({ cover: low, baseFt: 3500 });
  if (mid) out.push({ cover: mid, baseFt: 11_000 });
  return out;
}

/**
 * Sky & weather rendering:
 *  - Real-time sun (Cesium lighting follows the clock); photoreal tiles, which have baked daylight, are dimmed and
 *    tinted by solar elevation (golden hour, twilight, night).
 *  - Visibility fog: a depth-based post-process (works on 3D tiles and models, unlike globe fog), density from METAR /
 *    Open-Meteo visibility, strongest when the camera is inside the haze layer.
 *  - Cloud layer: procedural cumulus clouds at the reported cloud base around the followed aircraft.
 */
export class SkyController {
  private readonly fog: PostProcessStage;
  private readonly clouds: CloudCollection;
  private weather: WeatherInfo | null = null;
  private visibilityM = 50_000;
  private density = 0;
  private skyAmount = 0;
  private readonly fogBase = new Color(0.76, 0.79, 0.83, 1);
  private readonly fogColor = new Color(0.76, 0.79, 0.83, 1);
  private lastTone = 0;
  private cloudKey = '';
  private maxClouds = 60;
  private fogAllowed = true;
  private effects = true;
  private brightness = 1;
  /** Ground height (m, ellipsoid) under the focus point; set by the scene. */
  groundM = 0;

  constructor(
    private readonly viewer: Viewer,
    private readonly base: BaseLayers,
  ) {
    this.fog = new PostProcessStage({
      name: 'sv_visibility_fog',
      fragmentShader: `
        uniform sampler2D colorTexture;
        uniform sampler2D depthTexture;
        uniform float u_density;
        uniform float u_skyAmount;
        uniform vec3 u_fogColor;
        in vec2 v_textureCoordinates;
        void main() {
          vec4 color = texture(colorTexture, v_textureCoordinates);
          float raw = texture(depthTexture, v_textureCoordinates).r;
          if (raw >= 1.0) {
            out_FragColor = vec4(mix(color.rgb, u_fogColor, u_skyAmount), color.a);
            return;
          }
        #ifdef LOG_DEPTH
          // Logarithmic depth: undo the log encoding to get the distance along the view axis.
          float dist = exp2(raw * czm_log2FarDepthFromNearPlusOne) - 1.0 + czm_currentFrustum.x;
        #else
          vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, raw);
          float dist = -eye.z / eye.w;
        #endif
          float f = 1.0 - exp(-dist * u_density);
          out_FragColor = vec4(mix(color.rgb, u_fogColor, clamp(f, 0.0, 0.96)), color.a);
        }
      `,
      uniforms: {
        u_density: () => this.density,
        u_skyAmount: () => this.skyAmount,
        u_fogColor: () => this.fogColor,
      },
    });
    this.fog.enabled = false;
    viewer.scene.postProcessStages.add(this.fog);
    this.clouds = viewer.scene.primitives.add(new CloudCollection({ noiseDetail: 16 }));
  }

  configure(opts: { maxClouds: number; fog: boolean; effects: boolean }) {
    this.maxClouds = opts.maxClouds;
    this.fogAllowed = opts.fog;
    this.effects = opts.effects;
    this.cloudKey = '';
    if (!opts.effects || opts.maxClouds === 0) this.clouds.removeAll();
  }

  setWeather(w: WeatherInfo | null) {
    this.weather = w;
    this.visibilityM = w?.visibilityM ?? 50_000;
    const wx = w?.metar?.wx ?? '';
    // Haze / smoke / dust look brownish; mist and fog look grey-blue.
    if (/HZ|FU|DU|SA/.test(wx)) Color.fromBytes(198, 186, 165, 255, this.fogBase);
    else Color.fromBytes(196, 204, 214, 255, this.fogBase);
    this.tintFog();
    this.cloudKey = '';
  }

  /** Per-frame: cheap uniform updates; tone recomputed once per second. */
  update(now: number, focus?: { lat: number; lon: number }) {
    const cam = this.viewer.camera.positionCartographic;
    if (now - this.lastTone > 1000) {
      this.lastTone = now;
      const elev = solarElevationDeg(CesiumMath.toDegrees(cam.latitude), CesiumMath.toDegrees(cam.longitude), sceneNowMs());
      const tone = skyTone(elev);
      this.brightness = tone.brightness;
      this.base.setTileTone(tone.brightness, tone.tint);
      this.tintFog();
      for (const c of [this.clouds]) {
        for (let i = 0; i < c.length; i++) c.get(i).brightness = clamp(tone.brightness * 1.05, 0.12, 1);
      }
    }
    // Fog: only meaningful when visibility is reduced and the camera is low (inside the haze layer).
    const camAgl = Math.max(0, cam.height - this.groundM);
    const inLayer = clamp(1 - (camAgl - 1200) / 3500, 0.06, 1);
    const reduced = this.visibilityM < 15_000;
    const on = this.effects && this.fogAllowed && reduced;
    this.fog.enabled = on;
    if (on) {
      this.density = (3 / Math.max(150, this.visibilityM)) * inLayer;
      this.skyAmount = clamp((1 - this.visibilityM / 8000) * inLayer, 0, 0.75);
    }
    if (focus && this.effects && this.maxClouds > 0) this.updateClouds(focus);
  }

  /** Fog gets darker at night (it scatters whatever light there is). */
  private tintFog() {
    const k = clamp(this.brightness, 0.08, 1);
    this.fogColor.red = this.fogBase.red * k;
    this.fogColor.green = this.fogBase.green * k;
    this.fogColor.blue = this.fogBase.blue * (k * 0.9 + 0.1);
  }

  private updateClouds(focus: { lat: number; lon: number }) {
    const layers = cloudLayersFrom(this.weather);
    // Rebuild only when the focus moves to another ~8 km cell or the weather changes.
    const cell = `${Math.round(focus.lat * 14)}:${Math.round(focus.lon * 14)}`;
    const key = `${cell}|${layers.map((l) => `${l.cover}${l.baseFt}`).join(',')}|${this.maxClouds}`;
    if (key === this.cloudKey) return;
    this.cloudKey = key;
    this.clouds.removeAll();
    if (!layers.length) return;
    const rand = mulberry32(Math.abs(Math.round(focus.lat * 100) * 7919 + Math.round(focus.lon * 100)));
    const radiusM = 14_000;
    for (const layer of layers) {
      const n = Math.round(this.maxClouds * (COVER_FRACTION[layer.cover] ?? 0) * (layers.length > 1 ? 0.6 : 1));
      const baseM = this.groundM + layer.baseFt * FT_TO_M;
      for (let i = 0; i < n; i++) {
        const r = radiusM * Math.sqrt(rand());
        const p = destinationPoint(focus.lat, focus.lon, rand() * 360, r);
        const w = 700 + rand() * 1500;
        const h = w * (0.28 + rand() * 0.2);
        this.clouds.add({
          position: Cartesian3.fromDegrees(p.lon, p.lat, baseM + h * 0.45),
          scale: new Cartesian2(w, h),
          maximumSize: new Cartesian3(w * 0.5, h * 0.5, w * 0.35),
          slice: 0.32 + rand() * 0.2,
          brightness: clamp(this.brightness * 1.05, 0.12, 1),
        });
      }
    }
  }

  destroy() {
    this.viewer.scene.postProcessStages.remove(this.fog);
    this.viewer.scene.primitives.remove(this.clouds);
  }
}

export function cartoDeg(c: Cartographic) {
  return { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude) };
}
