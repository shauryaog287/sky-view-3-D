import { Color, ColorBlendMode, Model, ShadowMode, type Scene } from 'cesium';
import type { ModelClass } from '../../shared/aircraftTypes';
import { airlineFromCallsign } from '../../shared/airlines';
import type { FrameAircraft } from './aircraftLayer';
import { aircraftModelMatrix } from './orientation';

interface Slot {
  model: Model;
  cls: ModelClass;
  ready: boolean;
}

const MODEL_URL = (c: ModelClass) => `/models/${c}.glb`;
const SELECT_COLOR = Color.fromCssColorString('#39d0ff');

/**
 * Level of detail: the nearest `maxModels` aircraft (within `maxDistance`) are drawn as glTF models; the rest stay
 * billboards. Models are recycled per class (hidden and reused) instead of being destroyed, so panning around does not
 * churn GPU resources. The glTF itself is fetched once per class and shared by Cesium's resource cache.
 */
export class ModelPool {
  maxModels = 16;
  maxDistance = 35_000;
  /** Followed/selected aircraft keep their model up to this distance. */
  focusDistance = 400_000;
  shadows = false;
  /** Aircraft whose model must not be drawn (e.g. the one we are sitting in for the cockpit view). */
  readonly hidden = new Set<string>();
  private readonly active = new Map<string, Slot>();
  private readonly spare = new Map<ModelClass, Slot[]>();
  private creating = 0;
  private readonly pending = new Map<ModelClass, number>();

  constructor(private readonly scene: Scene) {}

  update(list: readonly FrameAircraft[], selected: string | null, followed: string | null): Set<string> {
    const want = new Map<string, FrameAircraft>();
    for (const f of list) {
      if ((f.a.hex === selected || f.a.hex === followed) && f.dist < this.focusDistance) want.set(f.a.hex, f);
    }
    const near = list.filter((f) => f.dist < this.maxDistance && !want.has(f.a.hex)).sort((a, b) => a.dist - b.dist);
    for (const f of near) {
      if (want.size >= this.maxModels) break;
      want.set(f.a.hex, f);
    }
    // Release models no longer wanted.
    for (const [hex, slot] of this.active) {
      if (!want.has(hex)) {
        slot.model.show = false;
        this.active.delete(hex);
        const arr = this.spare.get(slot.cls) ?? [];
        arr.push(slot);
        this.spare.set(slot.cls, arr);
      }
    }
    const shown = new Set<string>();
    for (const [hex, f] of want) {
      let slot = this.active.get(hex);
      if (!slot) {
        slot = this.acquire(f.a.modelClass);
        if (!slot) continue;
        this.active.set(hex, slot);
        const al = airlineFromCallsign(f.a.state.callsign);
        slot.model.color = al?.color ? Color.fromCssColorString(al.color) : Color.WHITE;
        slot.model.colorBlendAmount = al?.color ? 0.22 : 0;
      }
      const sel = hex === selected || hex === followed;
      slot.model.silhouetteSize = sel ? 2 : 0;
      slot.model.silhouetteColor = SELECT_COLOR;
      slot.model.shadows = this.shadows ? ShadowMode.ENABLED : ShadowMode.DISABLED;
      aircraftModelMatrix(f.position, f.pose.heading, f.pose.pitch, f.pose.roll, slot.model.modelMatrix);
      slot.model.show = slot.ready && !this.hidden.has(hex);
      if (slot.ready) shown.add(hex);
    }
    return shown;
  }

  /**
   * A spare model of this class, or undefined while one is being created. Creation is asynchronous: the finished
   * model lands in the spare pool and is picked up on a later frame (the billboard stays visible meanwhile).
   */
  private acquire(cls: ModelClass): Slot | undefined {
    const spare = this.spare.get(cls);
    if (spare?.length) return spare.pop();
    if ((this.pending.get(cls) ?? 0) >= 2 || this.creating >= 6) return undefined;
    this.pending.set(cls, (this.pending.get(cls) ?? 0) + 1);
    this.creating++;
    Model.fromGltfAsync({
      url: MODEL_URL(cls),
      minimumPixelSize: 28,
      maximumScale: 600,
      colorBlendMode: ColorBlendMode.MIX,
      shadows: ShadowMode.DISABLED,
      show: false,
    })
      .then((model) => {
        this.scene.primitives.add(model);
        const slot: Slot = { model, cls, ready: false };
        model.readyEvent.addEventListener(() => (slot.ready = true));
        const arr = this.spare.get(cls) ?? [];
        arr.push(slot);
        this.spare.set(cls, arr);
      })
      .catch((e) => console.warn('[models] failed to load', cls, e))
      .finally(() => {
        this.pending.set(cls, (this.pending.get(cls) ?? 1) - 1);
        this.creating--;
      });
    return undefined;
  }

  release(hex: string) {
    const slot = this.active.get(hex);
    if (!slot) return;
    slot.model.show = false;
    this.active.delete(hex);
    const arr = this.spare.get(slot.cls) ?? [];
    arr.push(slot);
    this.spare.set(slot.cls, arr);
  }

  destroy() {
    const all = [...this.active.values(), ...[...this.spare.values()].flat()];
    for (const s of all) if (s.model && !s.model.isDestroyed()) this.scene.primitives.remove(s.model);
    this.active.clear();
    this.spare.clear();
  }
}
