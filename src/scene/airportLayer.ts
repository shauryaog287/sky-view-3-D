import {
  Cartesian2,
  Cartesian3,
  Color,
  CornerType,
  DistanceDisplayCondition,
  Entity,
  LabelStyle,
  Math as CesiumMath,
  PolylineDashMaterialProperty,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import type { AirportIndex, Airport } from '../../shared/airports';
import { FT_TO_M } from '../../shared/geo';
import type { BaseLayerKind } from './baseLayers';

const RUNWAY = Color.fromCssColorString('#2b313b').withAlpha(0.95);
const CENTRE = Color.fromCssColorString('#e8eef6').withAlpha(0.85);
const LABEL = Color.fromCssColorString('#cfe8ff');

/**
 * Draws runways and airport codes when photorealistic tiles are not shown (offline globe / ion terrain), so takeoffs
 * and landings still have a visible runway. Only airports near the camera are drawn; entities are cached per airport.
 */
export class AirportLayer {
  private readonly drawn = new Map<string, Entity[]>();
  private layer: BaseLayerKind = 'offline';
  private airports?: AirportIndex;

  constructor(private readonly viewer: Viewer) {
    viewer.camera.moveEnd.addEventListener(this.refresh);
  }

  setAirports(a: AirportIndex) {
    this.airports = a;
    this.refresh();
  }

  setLayer(kind: BaseLayerKind) {
    this.layer = kind;
    this.refresh();
  }

  readonly refresh = () => {
    if (!this.airports) return;
    const show = this.layer !== 'google3d';
    const cam = this.viewer.camera.positionCartographic;
    const h = cam.height;
    const want = new Set<string>();
    if (show && h < 800_000) {
      const radius = Math.min(400_000, Math.max(60_000, h * 2.5));
      const near = this.airports.within(CesiumMath.toDegrees(cam.latitude), CesiumMath.toDegrees(cam.longitude), radius);
      for (const { airport } of near.slice(0, 60)) {
        if (h > 150_000 && airport.kind !== 'L') continue;
        want.add(airport.ident);
        if (!this.drawn.has(airport.ident)) this.drawn.set(airport.ident, this.draw(airport));
      }
    }
    for (const [ident, ents] of this.drawn) {
      if (!want.has(ident)) {
        for (const e of ents) this.viewer.entities.remove(e);
        this.drawn.delete(ident);
      }
    }
  };

  private draw(a: Airport): Entity[] {
    const out: Entity[] = [];
    const add = (e: Entity.ConstructorOptions) => out.push(this.viewer.entities.add(e));
    for (const r of a.runways) {
      const positions = Cartesian3.fromDegreesArray([r.le.lon, r.le.lat, r.he.lon, r.he.lat]);
      add({
        corridor: {
          positions,
          width: Math.max(30, r.widthFt * FT_TO_M),
          material: RUNWAY,
          cornerType: CornerType.BEVELED,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 250_000),
        },
      });
      add({
        polyline: {
          positions,
          width: 2,
          clampToGround: true,
          material: new PolylineDashMaterialProperty({ color: CENTRE, dashLength: 24 }),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 30_000),
        },
      });
      for (const end of [r.le, r.he]) {
        if (!end.ident) continue;
        add({
          position: Cartesian3.fromDegrees(end.lon, end.lat, 5),
          label: {
            text: end.ident,
            font: '600 12px system-ui, sans-serif',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }
    add({
      position: Cartesian3.fromDegrees(a.lon, a.lat, a.elevFt * FT_TO_M + 30),
      label: {
        text: a.iata ?? a.ident,
        font: '700 13px system-ui, sans-serif',
        fillColor: LABEL,
        outlineColor: Color.fromCssColorString('#020814'),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -6),
        distanceDisplayCondition: new DistanceDisplayCondition(8_000, a.kind === 'L' ? 900_000 : 250_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    return out;
  }

  destroy() {
    this.viewer.camera.moveEnd.removeEventListener(this.refresh);
    for (const ents of this.drawn.values()) for (const e of ents) this.viewer.entities.remove(e);
    this.drawn.clear();
  }
}
