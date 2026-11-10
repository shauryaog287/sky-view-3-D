import { BillboardCollection, BlendOption, Cartesian3, Color, Matrix4, NearFarScalar, type Billboard, type Scene } from 'cesium';
import type { ModelEntry } from '../../shared/aircraftModels';
import { glowSprite } from './airfieldLights';

type V3 = [number, number, number];

const WHITE = Color.fromBytes(255, 250, 240, 255);
const RED = Color.fromBytes(255, 40, 30, 255);
const GREEN = Color.fromBytes(50, 255, 110, 255);
const LANDING = Color.fromBytes(255, 248, 225, 255);
const SCALE = new NearFarScalar(150, 2.2, 20_000, 0.6);
const FADE = new NearFarScalar(5000, 1, 60_000, 0.25);
const EYE = new Cartesian3(0, 0, -1.5);
const PER_AIRCRAFT = 9;
const scratch = new Cartesian3();
const fwd = new Cartesian3();
const toCam = new Cartesian3();

export interface LitAircraft {
  matrix: Matrix4;
  entry: ModelEntry;
  /** Landing lights on (below 10,000 ft or around an airport). */
  landing: boolean;
  /** Stable per-aircraft number so strobes of different aircraft are not in sync. */
  seed: number;
}

/**
 * Aircraft lighting for the 3D models: white wingtip strobes (double flash), red beacons above and below, red/green/
 * white navigation lights, and landing lights that are brightest when the aircraft is flying towards the viewer —
 * which is how you spot arrivals on final at night. Positions come from each model's manifest entry.
 */
export class AircraftLights {
  private readonly collection: BillboardCollection;
  private readonly bbs: Billboard[] = [];

  constructor(scene: Scene) {
    this.collection = scene.primitives.add(new BillboardCollection({ scene, blendOption: BlendOption.TRANSLUCENT }));
  }

  private bb(i: number): Billboard {
    while (this.bbs.length <= i) {
      this.bbs.push(this.collection.add({ position: new Cartesian3(), image: glowSprite(), show: false, scaleByDistance: SCALE, translucencyByDistance: FADE, eyeOffset: EYE }));
    }
    return this.bbs[i];
  }

  /** `t` seconds; `night` 0–1 (navigation lights are off by day, the rest dimmed). */
  update(list: readonly LitAircraft[], t: number, night: number, cameraWC: Cartesian3) {
    let n = 0;
    const put = (m: Matrix4, p: V3, mirror: boolean, color: Color, px: number, on: boolean, alpha = 1) => {
      const b = this.bb(n++);
      if (!on || alpha <= 0.02) {
        b.show = false;
        return;
      }
      Cartesian3.fromElements(p[0], mirror ? -p[1] : p[1], p[2], scratch);
      b.position = Matrix4.multiplyByPoint(m, scratch, scratch);
      b.color = alpha >= 0.99 ? color : Color.fromAlpha(color, alpha, new Color());
      b.width = b.height = px;
      b.show = true;
    };
    const dayDim = 0.45 + 0.55 * night;
    for (const a of list) {
      const L = a.entry.lights ?? fallback(a.entry);
      const k = Math.max(0.7, Math.min(1.6, a.entry.length / 38));
      const phase = (t + a.seed * 1.37) % 1.2;
      const strobe = phase < 0.06 || (phase > 0.16 && phase < 0.22);
      const beacon = (t + a.seed * 0.71) % 1.1 < 0.14;
      put(a.matrix, L.tip, false, WHITE, 16 * k, strobe, dayDim);
      put(a.matrix, L.tip, true, WHITE, 16 * k, strobe, dayDim);
      put(a.matrix, L.top, false, RED, 13 * k, beacon, dayDim);
      put(a.matrix, L.belly, false, RED, 13 * k, beacon, dayDim);
      put(a.matrix, L.tip, false, RED, 7 * k, !strobe, night);
      put(a.matrix, L.tip, true, GREEN, 7 * k, !strobe, night);
      put(a.matrix, L.tail, false, WHITE, 6 * k, true, night);
      // Landing lights: a beam, so they flare when the aircraft points at the camera.
      let beam = 0;
      if (a.landing) {
        Matrix4.multiplyByPointAsVector(a.matrix, Cartesian3.UNIT_X, fwd);
        Matrix4.getTranslation(a.matrix, toCam);
        Cartesian3.subtract(cameraWC, toCam, toCam);
        Cartesian3.normalize(toCam, toCam);
        const facing = Cartesian3.dot(Cartesian3.normalize(fwd, fwd), toCam);
        beam = Math.max(0, facing) ** 3;
      }
      const size = (10 + 26 * beam) * k;
      const alpha = (0.25 + 0.75 * beam) * dayDim;
      put(a.matrix, L.land, false, LANDING, size, a.landing && beam > 0.02, alpha);
      put(a.matrix, L.land, true, LANDING, size, a.landing && beam > 0.02, alpha);
    }
    for (let i = n; i < this.bbs.length; i++) this.bbs[i].show = false;
    void PER_AIRCRAFT;
  }

  destroy(scene: Scene) {
    scene.primitives.remove(this.collection);
  }
}

/** Light positions for models without metadata (imported ones), from their dimensions. */
function fallback(e: ModelEntry): NonNullable<ModelEntry['lights']> {
  return {
    tip: [-e.length * 0.08, e.span / 2, e.height * 0.3],
    tail: [-e.length / 2, 0, e.height * 0.45],
    top: [0, 0, e.height * 0.52],
    belly: [0, 0, e.height * 0.12],
    land: [e.length * 0.05, e.span * 0.06, e.height * 0.2],
  };
}
