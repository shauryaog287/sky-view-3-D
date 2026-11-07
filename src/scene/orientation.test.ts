import { describe, expect, it } from 'vitest';
import { Cartesian3, Matrix4, Transforms, Ellipsoid } from 'cesium';
import { aircraftModelMatrix } from './orientation';

function localAxis(m: Matrix4, pos: Cartesian3, axis: Cartesian3) {
  // Express model axis in ENU coordinates at pos.
  const world = Matrix4.multiplyByPointAsVector(m, axis, new Cartesian3());
  const enu = Transforms.eastNorthUpToFixedFrame(pos, Ellipsoid.WGS84);
  const inv = Matrix4.inverseTransformation(enu, new Matrix4());
  return Matrix4.multiplyByPointAsVector(inv, world, new Cartesian3());
}

describe('aircraftModelMatrix', () => {
  const pos = Cartesian3.fromDegrees(77.1, 28.5, 1000);
  it('heading 90 points the nose east, wings north/south, up stays up', () => {
    const m = aircraftModelMatrix(pos, 90, 0, 0);
    const fwd = localAxis(m, pos, Cartesian3.UNIT_X);
    const left = localAxis(m, pos, Cartesian3.UNIT_Y);
    const up = localAxis(m, pos, Cartesian3.UNIT_Z);
    expect(fwd.x).toBeCloseTo(1, 6);
    expect(left.y).toBeCloseTo(1, 6); // left wing points north when flying east
    expect(up.z).toBeCloseTo(1, 6);
  });
  it('positive pitch raises the nose; positive roll drops the right wing', () => {
    const m = aircraftModelMatrix(pos, 0, 10, 20);
    const fwd = localAxis(m, pos, Cartesian3.UNIT_X);
    const left = localAxis(m, pos, Cartesian3.UNIT_Y);
    expect(fwd.z).toBeGreaterThan(0.17);
    expect(left.z).toBeGreaterThan(0.3); // left wing up = right wing down
  });
});
