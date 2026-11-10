import { Cartesian3, Cartesian4, Color, CustomShader, Model, ShadowMode, UniformType, type Scene } from 'cesium';
import { airlineFromCallsign } from '../../shared/airlines';
import { paintSchemeFor } from '../../shared/liveries';
import { AircraftLights, type LitAircraft } from './aircraftLights';
import { modelEntry, modelUrl } from '../../shared/aircraftModels';
import type { FrameAircraft } from './aircraftLayer';
import { aircraftModelMatrix } from './orientation';

interface Slot {
  model: Model;
  id: string;
  ready: boolean;
  /** Per-model livery shader (generated models only). */
  shader?: CustomShader;
  livery?: string;
  gearShown?: boolean;
}

const SELECT_COLOR = Color.fromCssColorString('#39d0ff');
const OFF = new Cartesian4(1, 1, 1, 0);

/**
 * Airline paint for the generated models (shared/liveries.ts). The models mark paint zones in the `_LIVERY` vertex
 * attribute (1 = fin and winglets, 0.5 = nacelles, 0.25 = fuselage); on the fuselage the texture coordinates give the
 * position along (u: tail → nose) and around (v) the body, so belly, cheatline and rear sweep are placed in the
 * shader while windows and door seams from the texture stay visible. Colours only — no logos.
 * One shader instance per pooled model; Cesium shares the compiled program.
 */
function liveryShader(): CustomShader {
  const v4 = () => ({ type: UniformType.VEC4, value: Cartesian4.clone(OFF) });
  return new CustomShader({
    uniforms: { u_tail: v4(), u_tail2: v4(), u_body: v4(), u_belly: v4(), u_cheat: v4(), u_sweep: v4(), u_engine: v4() },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        float zone = fsInput.attributes.livery;
        vec2 uv = fsInput.attributes.texCoord_0;
        vec3 d = material.diffuse;
        if (zone > 0.75) {
          vec3 c = mix(u_tail.rgb, u_tail2.rgb, u_tail2.a * step(0.62, uv.y));
          d = mix(d, c, u_tail.a);
        } else if (zone > 0.38) {
          d = mix(d, u_engine.rgb, u_engine.a);
        } else if (zone > 0.15) {
          // Height on the fuselage side: +1 crown, 0 widest point, -1 keel.
          float h = sin(uv.y * 6.2831853);
          // Painted skin is bright in the texture; windows, windscreen and seams are dark and keep their colour.
          float lum = clamp(dot(d, vec3(0.3333)) / 0.88, 0.0, 1.0);
          float skin = smoothstep(0.3, 0.62, lum);
          d = mix(d, d * u_body.rgb, u_body.a);
          d = mix(d, u_belly.rgb * lum, u_belly.a * skin * (1.0 - smoothstep(-0.5, -0.42, h)));
          d = mix(d, u_cheat.rgb, u_cheat.a * skin * step(-0.2, h) * step(h, -0.1) * step(0.13, uv.x) * step(uv.x, 0.9));
          float edge = u_sweep.a * (0.55 + 0.45 * h);
          d = mix(d, u_sweep.rgb * lum, skin * step(uv.x, edge) * step(0.001, u_sweep.a));
        }
        material.diffuse = d;
      }`,
  });
}

/** CSS sRGB colour → linear RGB (Cesium lights model materials in linear space) with a strength in w. */
function paint4(css: string | undefined, w = 1): Cartesian4 {
  if (!css) return OFF;
  const c = Color.fromCssColorString(css);
  return new Cartesian4(c.red ** 2.2, c.green ** 2.2, c.blue ** 2.2, w);
}

/**
 * Level of detail: the nearest `maxModels` aircraft (within `maxDistance`) are drawn as glTF models; the rest stay
 * billboards. Each aircraft gets the model of its ICAO type (A320neo, 777-300ER, ATR 72 …, see shared/aircraftModels).
 * Models are recycled per type (hidden and reused) instead of being destroyed, so panning around does not churn GPU
 * resources; the glTF itself is fetched once per type and shared by Cesium's resource cache.
 */
export class ModelPool {
  maxModels = 16;
  maxDistance = 35_000;
  /** Followed/selected aircraft keep their model up to this distance. */
  focusDistance = 400_000;
  shadows = false;
  /** Selection outline. Turned off for zoomed ground cameras (narrow FOV makes Cesium's silhouette pass ring). */
  silhouettes = true;
  /** Aircraft whose model must not be drawn (e.g. the one we are sitting in for the cockpit view). */
  readonly hidden = new Set<string>();
  /** Whether the landing gear is down (set by the scene from the flight phase). Defaults to "on the ground". */
  gearDown: (f: FrameAircraft) => boolean = (f) => f.pose.altFt === null;
  private readonly active = new Map<string, Slot>();
  private readonly spare = new Map<string, Slot[]>();
  private creating = 0;
  private readonly pending = new Map<string, number>();

  /** 0 by day … 1 at night (set by the scene): navigation lights only show in the dark. */
  night = 0;
  private readonly lights: AircraftLights;

  constructor(private readonly scene: Scene) {
    this.lights = new AircraftLights(scene);
  }

  private lastPick = 0;
  private picked = new Set<string>();

  update(list: readonly FrameAircraft[], selected: string | null, followed: string | null): Set<string> {
    // Re-choose which aircraft deserve a model 4×/s (sorting every frame is wasted work); matrices update every frame.
    const t = performance.now();
    if (t - this.lastPick > 250 || (selected && !this.picked.has(selected)) || (followed && !this.picked.has(followed))) {
      this.lastPick = t;
      const next = new Set<string>();
      for (const f of list) if ((f.a.hex === selected || f.a.hex === followed) && f.dist < this.focusDistance) next.add(f.a.hex);
      const near = list.filter((f) => f.dist < this.maxDistance && !next.has(f.a.hex)).sort((a, b) => a.dist - b.dist);
      for (const f of near) {
        if (next.size >= this.maxModels) break;
        next.add(f.a.hex);
      }
      this.picked = next;
    }
    const want = new Map<string, FrameAircraft>();
    for (const f of list) if (this.picked.has(f.a.hex)) want.set(f.a.hex, f);
    // Release models no longer wanted (or whose type changed, e.g. the type arrived with a later report).
    for (const [hex, slot] of this.active) {
      const f = want.get(hex);
      if (!f || f.a.modelId !== slot.id) this.park(hex, slot);
    }
    const shown = new Set<string>();
    const lit: LitAircraft[] = [];
    for (const [hex, f] of want) {
      let slot = this.active.get(hex);
      if (!slot) {
        slot = this.acquire(f.a.modelId);
        if (!slot) continue;
        this.active.set(hex, slot);
      }
      this.paint(slot, f);
      const sel = hex === selected || hex === followed;
      slot.model.silhouetteSize = sel && this.silhouettes ? 2 : 0;
      slot.model.silhouetteColor = SELECT_COLOR;
      slot.model.shadows = this.shadows ? ShadowMode.ENABLED : ShadowMode.DISABLED;
      aircraftModelMatrix(f.position, f.pose.heading, f.pose.pitch, f.pose.roll, slot.model.modelMatrix);
      if (slot.ready) this.setGear(slot, this.gearDown(f));
      slot.model.show = slot.ready && !this.hidden.has(hex);
      if (slot.ready) shown.add(hex);
      if (slot.model.show) lit.push({ matrix: slot.model.modelMatrix, entry: modelEntry(slot.id), landing: this.gearDown(f) || (f.pose.altFt !== null && f.pose.altFt < 10_000), seed: parseInt(hex.slice(-3), 16) / 4096 || 0 });
    }
    this.lights.update(lit, t / 1000, this.night, this.scene.camera.positionWC);
    return shown;
  }

  /** Airline paint scheme on generated models. Imported models keep their own textures untouched. */
  private paint(slot: Slot, f: FrameAircraft) {
    if (!slot.shader) return;
    const icao = airlineFromCallsign(f.a.state.callsign)?.icao;
    if (slot.livery === (icao ?? '')) return;
    slot.livery = icao ?? '';
    const s = paintSchemeFor(icao);
    const sh = slot.shader;
    sh.setUniform('u_tail', paint4(s?.tail));
    sh.setUniform('u_tail2', paint4(s?.tail2));
    sh.setUniform('u_body', paint4(s?.body));
    sh.setUniform('u_belly', paint4(s?.belly));
    sh.setUniform('u_cheat', paint4(s?.cheat));
    sh.setUniform('u_sweep', paint4(s?.sweep?.[0], s?.sweep?.[1] ?? 0));
    sh.setUniform('u_engine', paint4(s?.engine));
  }

  private setGear(slot: Slot, down: boolean) {
    if (slot.gearShown === down) return;
    const node = modelEntry(slot.id).gear ? slot.model.getNode('gear') : undefined;
    if (node) node.show = down;
    slot.gearShown = down;
  }

  private park(hex: string, slot: Slot) {
    slot.model.show = false;
    this.active.delete(hex);
    const arr = this.spare.get(slot.id) ?? [];
    arr.push(slot);
    this.spare.set(slot.id, arr);
  }

  /**
   * A spare model of this type, or undefined while one is being created. Creation is asynchronous: the finished
   * model lands in the spare pool and is picked up on a later frame (the billboard stays visible meanwhile).
   */
  private acquire(id: string): Slot | undefined {
    const spare = this.spare.get(id);
    if (spare?.length) return spare.pop();
    if ((this.pending.get(id) ?? 0) >= 2 || this.creating >= 6) return undefined;
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    this.creating++;
    const entry = modelEntry(id);
    const shader = entry.livery ? liveryShader() : undefined;
    Model.fromGltfAsync({
      url: modelUrl(entry),
      minimumPixelSize: 28,
      maximumScale: 600,
      shadows: ShadowMode.DISABLED,
      show: false,
      customShader: shader,
    })
      .then((model) => {
        this.scene.primitives.add(model);
        const slot: Slot = { model, id, ready: false, shader };
        model.readyEvent.addEventListener(() => (slot.ready = true));
        const arr = this.spare.get(id) ?? [];
        arr.push(slot);
        this.spare.set(id, arr);
      })
      .catch((e) => console.warn('[models] failed to load', id, e))
      .finally(() => {
        this.pending.set(id, (this.pending.get(id) ?? 1) - 1);
        this.creating--;
      });
    return undefined;
  }

  release(hex: string) {
    const slot = this.active.get(hex);
    if (slot) this.park(hex, slot);
  }

  destroy() {
    const all = [...this.active.values(), ...[...this.spare.values()].flat()];
    for (const s of all) if (s.model && !s.model.isDestroyed()) this.scene.primitives.remove(s.model);
    this.active.clear();
    this.spare.clear();
  }
}
