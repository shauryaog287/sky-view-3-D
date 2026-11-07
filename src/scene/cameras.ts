import {
  Cartesian3,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  PerspectiveFrustum,
  Ellipsoid,
  type Viewer,
} from 'cesium';
import type { AircraftLayer, FrameAircraft } from './aircraftLayer';
import type { CameraMode } from '../state/selection';
import { modelEntry } from '../../shared/aircraftModels';
import { angleDiff, clamp, norm360 } from '../../shared/geo';
import { aircraftModelMatrix } from './orientation';

/** A fixed ground camera (tower / runway end) that tracks an aircraft. Provided by the airport preset system. */
export interface GroundCamera {
  position: Cartesian3;
  label: string;
}

const scratchEnu = new Matrix4();
const scratchMat = new Matrix4();
const scratchV = new Cartesian3();
const scratchV2 = new Cartesian3();
const DEFAULT_FOV = CesiumMath.toRadians(60);

/**
 * Follow cameras. Runs every frame after the aircraft layer has computed poses, so the camera and the model use the
 * exact same position (no jitter between them).
 *
 *  orbit   – free orbit around the aircraft (user drags to rotate, pinches to zoom); world-aligned.
 *  chase   – behind and above, aligned with the (smoothed) track; pinch to change distance.
 *  cockpit – at the nose, looking along heading/pitch/roll.
 *  tower / runway – fixed ground camera that pans and zooms (FOV) to keep the aircraft framed.
 */
export class CameraRig {
  mode: CameraMode = 'free';
  target: string | null = null;
  groundCamera?: GroundCamera;
  /**
   * Narrowest ground-camera field of view (degrees). Real 3D tiles hold up to a tight zoom; flat imagery smears at
   * grazing angles, so the scene widens this when photoreal tiles are not active.
   */
  minGroundFovDeg = 10;
  private engaged = false;
  private smoothHeading?: number;
  private chaseRange = 0;
  private lastApplied = 0;
  private lastFrame = 0;
  private reduceMotion = false;
  /** Set while waiting for a just-added aircraft to get its first rendered frame. */
  private pendingSince?: number;

  constructor(
    private readonly viewer: Viewer,
    private readonly layer: AircraftLayer,
  ) {
    try {
      this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      /* ignore */
    }
  }

  /** Start following `hex` with `mode`. Flies there first unless reduced motion is requested. */
  follow(hex: string, mode: CameraMode, now: number) {
    const changingTarget = hex !== this.target;
    this.target = hex;
    this.mode = mode;
    this.engaged = false;
    this.smoothHeading = undefined;
    this.layer.models?.hidden.clear();
    const f = this.layer.frameOf(hex);
    if (!f) {
      // The aircraft was just added (search result, replay) and has not been drawn yet: start on the next frame.
      this.pendingSince = now;
      return;
    }
    this.pendingSince = undefined;
    const size = modelEntry(f.a.modelId);
    if (changingTarget || !this.chaseRange) this.chaseRange = Math.max(80, size.length * 3.2);
    this.setControls(mode);
    this.resetFov();
    const camera = this.viewer.camera;
    camera.lookAtTransform(Matrix4.IDENTITY);
    if (mode === 'cockpit' || mode === 'tower' || mode === 'runway' || this.reduceMotion) {
      this.engaged = true;
      this.update(now);
      return;
    }
    // Fly to where the aircraft will be when the flight ends.
    const duration = 1.4;
    const ahead = f.a.motion.sample(now + duration * 1000);
    const target = Cartesian3.fromDegrees(ahead.lon, ahead.lat, f.height + (ahead.altFt === null ? 0 : 0));
    const heading = CesiumMath.toRadians(mode === 'chase' ? ahead.heading : norm360(ahead.heading + 35));
    const pitch = CesiumMath.toRadians(mode === 'chase' ? -10 : -22);
    const range = mode === 'chase' ? this.chaseRange : Math.max(150, size.length * 5);
    const dest = offsetFrom(target, heading, pitch, range);
    camera.flyTo({
      destination: dest,
      orientation: { heading, pitch, roll: 0 },
      duration,
      complete: () => {
        this.engaged = true;
        if (mode === 'orbit') {
          const ff = this.layer.frameOf(hex);
          if (ff) {
            Transforms.eastNorthUpToFixedFrame(ff.position, Ellipsoid.WGS84, scratchEnu);
            camera.lookAtTransform(scratchEnu, new HeadingPitchRange(heading, pitch, range));
          }
        }
      },
      cancel: () => this.stop(),
    });
  }

  setMode(mode: CameraMode, now: number) {
    if (!this.target || mode === 'free') return this.stop();
    this.follow(this.target, mode, now);
  }

  stop() {
    this.pendingSince = undefined;
    this.mode = 'free';
    this.target = null;
    this.engaged = false;
    this.layer.models?.hidden.clear();
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    this.setControls('free');
    this.resetFov();
  }

  private setControls(mode: CameraMode) {
    const c = this.viewer.scene.screenSpaceCameraController;
    const free = mode === 'free';
    const orbit = mode === 'orbit';
    c.enableRotate = free || orbit;
    c.enableTilt = free || orbit;
    c.enableTranslate = free;
    c.enableLook = free;
    c.enableZoom = free || orbit || mode === 'chase';
  }

  private resetFov() {
    const fr = this.viewer.camera.frustum;
    if (fr instanceof PerspectiveFrustum) {
      fr.fov = DEFAULT_FOV;
      fr.near = 0.5;
    }
  }

  /** Called every frame. Returns false when the target vanished (caller should drop follow state). */
  update(now: number): boolean {
    if (this.mode === 'free' || !this.target) return true;
    const f = this.layer.frameOf(this.target);
    if (this.pendingSince !== undefined) {
      if (f) this.follow(this.target, this.mode, now);
      else return now - this.pendingSince < 3000; // give up (lost contact) if it never shows up
      return true;
    }
    if (!f) return false;
    const dt = this.lastFrame ? Math.min(0.2, (now - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = now;
    if (!this.engaged) return true;
    switch (this.mode) {
      case 'orbit':
        this.orbit(f);
        break;
      case 'chase':
        this.chase(f, dt);
        break;
      case 'cockpit':
        this.cockpit(f);
        break;
      case 'tower':
      case 'runway':
        this.ground(f);
        break;
    }
    return true;
  }

  private orbit(f: FrameAircraft) {
    const camera = this.viewer.camera;
    // Keep the user's current offset (they may have rotated/zoomed), re-anchored on the moving aircraft.
    const offset = Matrix4.equals(camera.transform, Matrix4.IDENTITY)
      ? new HeadingPitchRange(CesiumMath.toRadians(f.pose.heading + 35), CesiumMath.toRadians(-22), 300)
      : Cartesian3.clone(camera.position, scratchV2);
    Transforms.eastNorthUpToFixedFrame(f.position, Ellipsoid.WGS84, scratchEnu);
    camera.lookAtTransform(scratchEnu, offset);
  }

  private chase(f: FrameAircraft, dt: number) {
    const camera = this.viewer.camera;
    // Respect pinch-zoom: if the camera distance changed since we last set it, adopt the new range.
    if (!Matrix4.equals(camera.transform, Matrix4.IDENTITY)) {
      const cur = Cartesian3.magnitude(camera.position);
      if (this.lastApplied && Math.abs(cur - this.lastApplied) / this.lastApplied > 0.01) this.chaseRange = clamp(cur, 25, 20_000);
    }
    // Smooth the heading so small track jitter does not shake the view (time constant ≈ 0.6 s).
    const target = f.pose.heading;
    if (this.smoothHeading === undefined) this.smoothHeading = target;
    else this.smoothHeading = norm360(this.smoothHeading + angleDiff(this.smoothHeading, target) * (1 - Math.exp(-dt / 0.6)));
    const pitch = clamp(-9 + f.pose.pitch * 0.4, -30, 5);
    Transforms.eastNorthUpToFixedFrame(f.position, Ellipsoid.WGS84, scratchEnu);
    camera.lookAtTransform(scratchEnu, new HeadingPitchRange(CesiumMath.toRadians(this.smoothHeading), CesiumMath.toRadians(pitch), this.chaseRange));
    this.lastApplied = this.chaseRange;
  }

  private cockpit(f: FrameAircraft) {
    const camera = this.viewer.camera;
    const size = modelEntry(f.a.modelId);
    this.layer.models?.hidden.add(f.a.hex);
    aircraftModelMatrix(f.position, f.pose.heading, f.pose.pitch, f.pose.roll, scratchMat);
    // Eye point: near the nose, about one fuselage height above the gear.
    const eye = Matrix4.multiplyByPoint(scratchMat, new Cartesian3(size.length * 0.44, 0, size.length * 0.09 + 1.6), scratchV);
    camera.lookAtTransform(Matrix4.IDENTITY);
    camera.setView({
      destination: eye,
      orientation: {
        heading: CesiumMath.toRadians(f.pose.heading),
        pitch: CesiumMath.toRadians(f.pose.pitch - 5),
        roll: CesiumMath.toRadians(f.pose.roll),
      },
    });
  }

  private ground(f: FrameAircraft) {
    const g = this.groundCamera;
    if (!g) return;
    const camera = this.viewer.camera;
    camera.lookAtTransform(Matrix4.IDENTITY);
    const dir = Cartesian3.normalize(Cartesian3.subtract(f.position, g.position, scratchV), scratchV);
    const up = Ellipsoid.WGS84.geodeticSurfaceNormal(g.position, scratchV2);
    const right = Cartesian3.normalize(Cartesian3.cross(dir, up, new Cartesian3()), new Cartesian3());
    const trueUp = Cartesian3.cross(right, dir, new Cartesian3());
    camera.setView({ destination: g.position, orientation: { direction: dir, up: trueUp } });
    // Zoom like a spotter's camera: frame the aircraft, but never narrower than 10° so the horizon stays in view.
    const dist = Cartesian3.distance(g.position, f.position);
    const size = modelEntry(f.a.modelId).length;
    const fr = camera.frustum;
    if (fr instanceof PerspectiveFrustum) {
      fr.fov = clamp(2 * Math.atan((size * 3) / Math.max(1, dist)), CesiumMath.toRadians(this.minGroundFovDeg), DEFAULT_FOV);
      fr.near = 1;
    }
  }
}

/** Camera position `range` metres from `target`, looking at it with (heading, pitch). */
function offsetFrom(target: Cartesian3, heading: number, pitch: number, range: number): Cartesian3 {
  const enu = Transforms.eastNorthUpToFixedFrame(target, Ellipsoid.WGS84, new Matrix4());
  const local = new Cartesian3(
    -Math.sin(heading) * Math.cos(pitch) * range,
    -Math.cos(heading) * Math.cos(pitch) * range,
    -Math.sin(pitch) * range,
  );
  return Matrix4.multiplyByPoint(enu, local, new Cartesian3());
}
