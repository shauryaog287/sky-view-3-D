import { Cartesian3, Matrix3, Matrix4, Transforms, Ellipsoid } from 'cesium';

const D2R = Math.PI / 180;
const enu = new Matrix4();
const rot = new Matrix3();
const local = new Matrix4();

/**
 * Model matrix for an aircraft at `position` with compass heading / pitch / roll in degrees.
 * Cesium model space (after glTF axis correction) is +X forward, +Y left, +Z up. We build the rotation explicitly from
 * the local east-north-up frame so there is no ambiguity about HeadingPitchRoll conventions.
 */
export function aircraftModelMatrix(position: Cartesian3, headingDeg: number, pitchDeg: number, rollDeg: number, result = new Matrix4()): Matrix4 {
  Transforms.eastNorthUpToFixedFrame(position, Ellipsoid.WGS84, enu);
  const h = headingDeg * D2R;
  const p = pitchDeg * D2R;
  const r = rollDeg * D2R;
  // Forward (ENU): compass heading, pitched up by p.
  const fx = Math.sin(h) * Math.cos(p);
  const fy = Math.cos(h) * Math.cos(p);
  const fz = Math.sin(p);
  // Right wing before roll: horizontal, 90° clockwise from heading. Up before roll: right × forward.
  const rx0 = Math.cos(h);
  const ry0 = -Math.sin(h);
  const rz0 = 0;
  const ux0 = ry0 * fz - rz0 * fy;
  const uy0 = rz0 * fx - rx0 * fz;
  const uz0 = rx0 * fy - ry0 * fx;
  // Roll about forward: positive = right wing down.
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  const rx = rx0 * cr - ux0 * sr;
  const ry = ry0 * cr - uy0 * sr;
  const rz = rz0 * cr - uz0 * sr;
  const ux = ux0 * cr + rx0 * sr;
  const uy = uy0 * cr + ry0 * sr;
  const uz = uz0 * cr + rz0 * sr;
  // Columns: model X → forward, model Y → left (= −right), model Z → up.
  Matrix3.fromRowMajorArray([fx, -rx, ux, fy, -ry, uy, fz, -rz, uz], rot);
  Matrix4.fromRotationTranslation(rot, Cartesian3.ZERO, local);
  return Matrix4.multiply(enu, local, result);
}
