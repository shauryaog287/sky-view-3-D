import {
  BillboardCollection,
  LabelCollection,
  Cartesian2,
  Cartesian3,
  Color,
  NearFarScalar,
  DistanceDisplayCondition,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  Math as CesiumMath,
  type Billboard,
  type Label,
  type Viewer,
} from 'cesium';
import type { AircraftStore, LiveAircraft } from '../state/aircraftStore';
import type { Pose } from '../motion/smoother';
import { aircraftIcon, ICON_SCALE } from './icons';
import { FT_TO_M } from '../../shared/geo';
import type { ModelPool } from './modelPool';

export interface FrameAircraft {
  a: LiveAircraft;
  pose: Pose;
  position: Cartesian3;
  /** Ellipsoid height actually used for rendering (m). */
  height: number;
  /** Camera distance (m). */
  dist: number;
}

interface Visual {
  bb: Billboard;
  label?: Label;
  labelText?: string;
  frame?: FrameAircraft;
}

/** Converts a pose to a render height (m, ellipsoid). Replaced by the airport-aware resolver in the scene. */
export type HeightFn = (a: LiveAircraft, pose: Pose) => number;

const COLOR_NORMAL = Color.fromCssColorString('#f2f7ff');
const COLOR_GROUND = Color.fromCssColorString('#a9b9cc');
const COLOR_SELECTED = Color.fromCssColorString('#39d0ff');
const COLOR_EMERGENCY = Color.fromCssColorString('#ff5c6c');
const SCRATCH_COLOR = new Color();

/**
 * Renders every live aircraft. Far aircraft are billboards (cheap); the nearest N become glTF models via ModelPool.
 * Runs once per frame from scene.preRender, sampling each aircraft's MotionTrack at the frame time.
 */
export class AircraftLayer {
  readonly billboards: BillboardCollection;
  readonly labels: LabelCollection;
  private readonly visuals = new Map<string, Visual>();
  private seenVersion = -1;
  private frameList: FrameAircraft[] = [];
  selected: string | null = null;
  followed: string | null = null;
  heightFn: HeightFn = (_a, p) => (p.altFt === null ? 0 : p.altFt * FT_TO_M);
  models?: ModelPool;
  labelsForNearby = true;

  constructor(
    private readonly viewer: Viewer,
    private readonly store: AircraftStore,
  ) {
    this.billboards = viewer.scene.primitives.add(new BillboardCollection({ scene: viewer.scene }));
    this.labels = viewer.scene.primitives.add(new LabelCollection({ scene: viewer.scene }));
  }

  /** Aircraft as rendered this frame (shared with cameras so they see the exact same pose). */
  frameOf(hex: string | null | undefined): FrameAircraft | undefined {
    return hex ? this.visuals.get(hex)?.frame : undefined;
  }

  get frame(): readonly FrameAircraft[] {
    return this.frameList;
  }

  private sync() {
    if (this.seenVersion === this.store.version.value) return;
    this.seenVersion = this.store.version.value;
    for (const [hex, v] of this.visuals) {
      if (!this.store.map.has(hex)) {
        this.billboards.remove(v.bb);
        if (v.label) this.labels.remove(v.label);
        this.models?.release(hex);
        this.visuals.delete(hex);
      }
    }
    for (const a of this.store.map.values()) {
      if (this.visuals.has(a.hex)) continue;
      const bb = this.billboards.add({
        position: Cartesian3.ZERO,
        image: aircraftIcon(a.modelClass),
        scale: ICON_SCALE[a.modelClass],
        alignedAxis: Cartesian3.UNIT_Z,
        color: COLOR_NORMAL,
        scaleByDistance: new NearFarScalar(2.0e3, 1.15, 6.0e6, 0.45),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { hex: a.hex },
      });
      this.visuals.set(a.hex, { bb });
    }
  }

  update(now: number) {
    this.sync();
    const camPos = this.viewer.camera.positionWC;
    const list: FrameAircraft[] = [];
    for (const a of this.store.map.values()) {
      const v = this.visuals.get(a.hex);
      if (!v) continue;
      const pose = a.motion.sample(now);
      const height = this.heightFn(a, pose);
      const position = Cartesian3.fromDegrees(pose.lon, pose.lat, height, undefined, v.frame?.position);
      const dist = Cartesian3.distance(camPos, position);
      const f: FrameAircraft = v.frame ?? { a, pose, position, height, dist };
      f.a = a;
      f.pose = pose;
      f.position = position;
      f.height = height;
      f.dist = dist;
      v.frame = f;
      list.push(f);
    }
    this.frameList = list;
    // Choose which aircraft get a full 3D model (LOD), then draw billboards for the rest.
    const modelled = this.models ? this.models.update(list, this.selected, this.followed) : undefined;
    for (const f of list) {
      const v = this.visuals.get(f.a.hex)!;
      const { bb } = v;
      bb.position = f.position;
      bb.rotation = -CesiumMath.toRadians(f.pose.heading);
      const isSel = f.a.hex === this.selected || f.a.hex === this.followed;
      bb.show = !modelled?.has(f.a.hex);
      const base = isSel ? COLOR_SELECTED : isEmergency(f.a) ? COLOR_EMERGENCY : f.pose.altFt === null ? COLOR_GROUND : COLOR_NORMAL;
      const ageS = (now - f.a.motion.lastFixTime) / 1000;
      const alpha = ageS > 45 ? 0.45 : ageS > 20 ? 0.7 : 1;
      bb.color = Color.clone(base, SCRATCH_COLOR).withAlpha(alpha, SCRATCH_COLOR);
      bb.scale = ICON_SCALE[f.a.modelClass] * (isSel ? 1.35 : 1);
      this.updateLabel(v, f, isSel, list.length);
    }
  }

  private updateLabel(v: Visual, f: FrameAircraft, isSel: boolean, total: number) {
    // The followed aircraft is right in front of the camera: its label would just cover the model.
    if (f.a.hex === this.followed && f.dist < 3000) {
      if (v.label) v.label.show = false;
      return;
    }
    const want = isSel || (this.labelsForNearby && f.dist < 60_000 && total < 150) || (this.labelsForNearby && f.dist < 400_000 && total < 25);
    if (!want) {
      if (v.label) v.label.show = false;
      return;
    }
    const text = labelText(f);
    if (!v.label) {
      v.label = this.labels.add({
        position: f.position,
        text,
        font: '600 13px system-ui, sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#020814'),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.TOP,
        horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, 18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 2.0e6),
        id: { hex: f.a.hex },
      });
    }
    v.label.show = true;
    v.label.position = f.position;
    v.label.fillColor = isSel ? COLOR_SELECTED : Color.WHITE;
    if (v.labelText !== text) {
      v.label.text = text;
      v.labelText = text;
    }
  }

  /** Hex of the aircraft under a screen position (generous touch target). */
  pick(pos: Cartesian2): string | undefined {
    const picked = this.viewer.scene.pick(pos, 28, 28) as { id?: { hex?: string } } | undefined;
    const hex = picked?.id?.hex;
    if (hex) return hex;
    // Fallback: nearest billboard on screen within 30 px.
    let best: string | undefined;
    let bestD = 30;
    const scratch = new Cartesian2();
    for (const f of this.frameList) {
      const s = this.viewer.scene.cartesianToCanvasCoordinates(f.position, scratch);
      if (!s) continue;
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) {
        bestD = d;
        best = f.a.hex;
      }
    }
    return best;
  }

  destroy() {
    this.viewer.scene.primitives.remove(this.billboards);
    this.viewer.scene.primitives.remove(this.labels);
    this.models?.destroy();
  }
}

function isEmergency(a: LiveAircraft): boolean {
  const sq = a.state.squawk;
  return !!a.state.emergency || sq === '7500' || sq === '7600' || sq === '7700';
}

function labelText(f: FrameAircraft): string {
  const cs = f.a.state.callsign ?? f.a.state.reg ?? f.a.hex.toUpperCase();
  const alt = f.pose.altFt;
  const altTxt = alt === null ? 'GND' : alt >= 18000 ? `FL${Math.round(alt / 100)}` : `${Math.round(alt / 100) * 100} ft`;
  return `${cs}\n${altTxt}`;
}
