import { BillboardCollection, BlendOption, Cartesian3, Color, Matrix4, NearFarScalar, Transforms, type Billboard, type Scene } from 'cesium';
import { toLatLon } from '../../shared/airport3d';
import { LIGHT, LIGHT_RGB, papiColour, type AirfieldLighting } from '../../shared/airportLights';

let sprite: HTMLCanvasElement | undefined;
/** Soft glow: a bright core with a wide falloff, tinted per light. */
function glow(): HTMLCanvasElement {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  // Gaussian-like falloff in many small steps (no visible rings when the sprite is drawn large).
  for (let i = 0; i <= 16; i++) {
    const r = i / 16;
    const a = r < 0.14 ? 1 : Math.exp(-((r - 0.14) ** 2) / 0.035) * (1 - r);
    grad.addColorStop(r, `rgba(255,255,255,${a.toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (sprite = c);
}

const SIZE_PX = [0, 8, 11, 20];
const SCALE = new NearFarScalar(80, 2.0, 12_000, 0.55);
const FADE = new NearFarScalar(4000, 1, 48_000, 0.12);
/** Pull the sprite towards the eye so the ground does not cut the lower half of the glow. */
const EYE_OFFSET = new Cartesian3(0, 0, -3);
const COLORS = LIGHT_RGB.map(([r, g, b]) => Color.fromBytes(r, g, b, 255));
const scratch = new Cartesian3();
const FLASH_ON = 0.14;

/**
 * Renders one airport's lighting layout (shared/airportLights.ts) as glow sprites and keeps the dynamic parts alive:
 * direction-dependent colours (threshold green/red, caution amber, centreline red), sequenced approach flashers,
 * the tower beacon, and PAPI units that turn white/red with the camera's glide angle.
 */
export class AirfieldLightSet {
  private readonly collection: BillboardCollection;
  private readonly bbs: Billboard[] = [];
  private readonly toLocal: Matrix4;
  private readonly side: number[];
  private readonly byRunway: number[][];
  private readonly flashing: number[] = [];
  private readonly papi: number[] = [];
  private night = true;
  private dirty = true;
  private readonly centre: Cartesian3;

  constructor(
    private readonly scene: Scene,
    private readonly layout: AirfieldLighting,
    origin: [number, number],
    baseM: number,
  ) {
    this.collection = scene.primitives.add(new BillboardCollection({ scene, blendOption: BlendOption.TRANSLUCENT }));
    this.centre = Cartesian3.fromDegrees(origin[1], origin[0], baseM);
    this.toLocal = Matrix4.inverseTransformation(Transforms.eastNorthUpToFixedFrame(this.centre), new Matrix4());
    this.side = layout.runways.map(() => 0);
    this.byRunway = layout.runways.map(() => []);
    const image = glow();
    layout.lights.forEach((l, i) => {
      const ll = toLatLon(origin, l.x, l.y);
      const px = SIZE_PX[l.size];
      this.bbs.push(
        this.collection.add({
          position: Cartesian3.fromDegrees(ll.lon, ll.lat, baseM + l.z),
          image,
          width: px,
          height: px,
          color: COLORS[l.a || l.b],
          scaleByDistance: SCALE,
          translucencyByDistance: FADE,
          eyeOffset: EYE_OFFSET,
          show: false,
        }),
      );
      if (l.rw >= 0) this.byRunway[l.rw].push(i);
      if (l.period > 0) this.flashing.push(i);
      if (l.papi >= 0) this.papi.push(i);
    });
  }

  get count(): number {
    return this.bbs.length;
  }

  /** Night shows everything; by day only the PAPIs and approach flashers. */
  setNight(night: boolean) {
    if (night === this.night) return;
    this.night = night;
    this.dirty = true; // full colour/show pass on the next update
  }

  /** Per frame: `t` in seconds, camera position in world coordinates. */
  update(t: number, cameraWC: Cartesian3) {
    if (Cartesian3.distanceSquared(cameraWC, this.centre) > 70_000 ** 2) {
      this.collection.show = false;
      return;
    }
    this.collection.show = true;
    const cam = Matrix4.multiplyByPoint(this.toLocal, cameraWC, scratch);
    const { lights, runways } = this.layout;
    if (this.dirty) {
      this.dirty = false;
      this.side.fill(0);
      // Non-directional lights.
      lights.forEach((l, i) => {
        if (l.rw >= 0) return;
        this.bbs[i].show = (this.night || l.day) && l.period === 0;
      });
    }
    runways.forEach((r, k) => {
      const s = (cam.x - r.mx) * r.ax + (cam.y - r.my) * r.ay < 0 ? 1 : 2;
      if (s === this.side[k]) return;
      this.side[k] = s;
      for (const i of this.byRunway[k]) {
        const l = lights[i];
        if (l.papi >= 0) continue;
        const c = s === 1 ? l.a : l.b;
        const b = this.bbs[i];
        b.show = c !== LIGHT.OFF && (this.night || l.day) && l.period === 0;
        if (c !== LIGHT.OFF) b.color = COLORS[c];
      }
    });
    for (const i of this.flashing) {
      const l = lights[i];
      const c = l.rw < 0 ? l.a : this.side[l.rw] === 1 ? l.a : l.b;
      const phase = (t / l.period + l.phase) % 1;
      this.bbs[i].show = c !== LIGHT.OFF && (this.night || l.day) && phase < FLASH_ON;
    }
    for (const i of this.papi) {
      const l = lights[i];
      const b = this.bbs[i];
      // Visible from its own approach side only, within ~20 km.
      const mine = this.side[l.rw] === (l.end === 0 ? 1 : 2);
      const dist = Math.hypot(cam.x - l.x, cam.y - l.y);
      if (!mine || dist > 20_000) {
        b.show = false;
        continue;
      }
      const angle = (Math.atan2(cam.z - l.z, Math.max(dist, 1)) * 180) / Math.PI;
      b.show = true;
      b.color = COLORS[papiColour(l.papi, angle)];
    }
  }

  destroy() {
    this.scene.primitives.remove(this.collection);
  }
}
