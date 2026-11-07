import { Cartesian3, Color, CustomShader, Model, ShadowMode, UniformType, type Scene } from 'cesium';
import { airlineFromCallsign } from '../../shared/airlines';
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
const WHITE = new Cartesian3(1, 1, 1);

/**
 * Tail/winglet paint: generated models mark those surfaces with the `_LIVERY` vertex attribute (0…1) and this shader
 * mixes in the operator's brand colour. One shader instance per pooled model; Cesium shares the compiled program.
 */
function liveryShader(): CustomShader {
  return new CustomShader({
    uniforms: {
      u_livery: { type: UniformType.VEC3, value: Cartesian3.clone(WHITE) },
      u_liveryOn: { type: UniformType.FLOAT, value: 0 },
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        float k = clamp(fsInput.attributes.livery * u_liveryOn, 0.0, 1.0);
        material.diffuse = mix(material.diffuse, u_livery, k);
      }`,
  });
}

/** CSS sRGB colour → linear RGB (Cesium lights model materials in linear space). */
function linear(css: string): Cartesian3 {
  const c = Color.fromCssColorString(css);
  return new Cartesian3(c.red ** 2.2, c.green ** 2.2, c.blue ** 2.2);
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

  constructor(private readonly scene: Scene) {}

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
    for (const [hex, f] of want) {
      let slot = this.active.get(hex);
      if (!slot) {
        slot = this.acquire(f.a.modelId);
        if (!slot) continue;
        this.active.set(hex, slot);
        this.paint(slot, f);
      }
      const sel = hex === selected || hex === followed;
      slot.model.silhouetteSize = sel && this.silhouettes ? 2 : 0;
      slot.model.silhouetteColor = SELECT_COLOR;
      slot.model.shadows = this.shadows ? ShadowMode.ENABLED : ShadowMode.DISABLED;
      aircraftModelMatrix(f.position, f.pose.heading, f.pose.pitch, f.pose.roll, slot.model.modelMatrix);
      if (slot.ready) this.setGear(slot, this.gearDown(f));
      slot.model.show = slot.ready && !this.hidden.has(hex);
      if (slot.ready) shown.add(hex);
    }
    return shown;
  }

  /** Operator colour on the tail of generated models. Imported models keep their own textures untouched. */
  private paint(slot: Slot, f: FrameAircraft) {
    if (!slot.shader) return;
    const color = airlineFromCallsign(f.a.state.callsign)?.color;
    if (slot.livery === color) return;
    slot.livery = color;
    slot.shader.setUniform('u_livery', color ? linear(color) : WHITE);
    slot.shader.setUniform('u_liveryOn', color ? 1 : 0);
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
