import {
  Appearance,
  BoundingSphere,
  Cartesian3,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  Matrix3,
  Matrix4,
  Primitive,
  PrimitiveType,
  ShadowMode,
  Transforms,
  type GeometryAttributes,
} from 'cesium';
import { toLatLon } from '../../shared/airport3d';
import type { AirportMesh } from '../../shared/airportMesh';

/**
 * Facade shader for the airport mesh (shared/airportMesh.ts). Everything is procedural from the per-vertex material
 * id, wall coordinates in metres and a per-building random number — no textures to download:
 *  - walls with a window grid, glazed curtain walls (terminals, offices), ribbed metal cladding (hangars), flat and
 *    standing-seam roofs with rooftop plant, tower cab glazing, jet-bridge window strips, car-park decks;
 *  - daylight from the scene's sun with sky ambient and glass reflections;
 *  - at night (sun below the horizon at the airport) rooms and concourses light up and the floodlit apron side of
 *    buildings gets a warm wash.
 */
const VS = /* glsl */ `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in vec3 aColor;
in vec3 aMat;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_uv;
out vec3 v_color;
out vec3 v_mat;

void main() {
  vec4 p = czm_computePosition();
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = czm_normal * normal;
  v_uv = st;
  v_color = aColor;
  v_mat = aMat;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

const FS = /* glsl */ `
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec2 v_uv;
in vec3 v_color;
in vec3 v_mat;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 1 when a pattern of this cell size (metres) is resolvable on screen, fading to 0 when cells shrink below a pixel
// (the pattern is then replaced by its average, so distant facades do not sparkle).
float detail(float cell) {
  float w = max(fwidth(v_uv.x), fwidth(v_uv.y));
  return 1.0 - smoothstep(0.3, 0.75, w / cell);
}

void main() {
  vec3 N = normalize(v_normalEC);
  vec3 V = normalize(-v_positionEC);
  vec3 posWC = (czm_inverseView * vec4(v_positionEC, 1.0)).xyz;
  vec3 upWC = normalize(posWC);
  vec3 nWC = czm_inverseViewRotation * N;
  float sunElev = dot(upWC, czm_sunDirectionWC);
  float day = smoothstep(-0.10, 0.14, sunElev);
  float night = 1.0 - smoothstep(-0.12, 0.03, sunElev);
  float upness = dot(nWC, upWC);

  float id = v_mat.x;
  float seed = v_mat.y;
  float top = v_mat.z;
  vec3 base = v_color;
  vec3 emissive = vec3(0.0);
  float gloss = 0.0;
  float glass = 0.0;

  if (id < 0.5) {
    // Wall with punched windows: 3 m bays, 3.4 m storeys, no windows in the plinth or parapet.
    vec2 cell = vec2(v_uv.x / 3.0, v_uv.y / 3.4);
    vec2 f = fract(cell);
    vec2 c = floor(cell);
    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.32, f.y) * step(f.y, 0.78);
    win *= step(0.5, v_uv.y) * step(v_uv.y, top - 0.9);
    // Some bays are blank (stair cores, plant rooms).
    win *= step(0.12, hash(vec2(c.x, 7.0 + seed * 53.0)));
    float lit = step(0.63, hash(c + seed * 91.0));
    float k = detail(3.0);
    // Far away: the facade's average (36 % glazing, 37 % of it lit).
    win = mix(0.3 * step(0.5, v_uv.y) * step(v_uv.y, top - 0.9), win, k);
    lit = mix(0.37, lit, k);
    base = mix(base * (0.94 + 0.06 * hash(vec2(c.y, seed)) * k), vec3(0.11, 0.15, 0.2), win);
    emissive = win * lit * night * vec3(1.0, 0.8, 0.52) * (0.55 + 0.45 * hash(c * 1.7 + seed) * k);
    glass = win;
    // Parapet coping.
    base = mix(base, base * 0.82, step(top - 0.35, v_uv.y));
  } else if (id < 1.5) {
    // Curtain wall: 2.4 m mullions, 4.8 m floors, a solid fascia under the roof and a plinth.
    vec2 cell = vec2(v_uv.x / 2.4, v_uv.y / 4.8);
    vec2 f = fract(cell);
    vec2 c = floor(cell);
    float frame = max(step(f.x, 0.045), step(f.y, 0.06));
    float solid = max(step(top - 1.5, v_uv.y), step(v_uv.y, 0.5));
    float k = detail(2.4);
    frame = max(mix(0.08, frame, k), solid);
    float litCell = mix(0.78, step(0.22, hash(vec2(floor(c.x / 3.0) + seed * 17.0, c.y))), detail(7.2));
    vec3 tint = base * 0.42;
    base = mix(tint, vec3(0.78, 0.8, 0.82), frame);
    emissive = (1.0 - frame) * night * litCell * vec3(1.0, 0.86, 0.6) * (0.5 + 0.3 * hash(c + seed));
    glass = 1.0 - frame;
  } else if (id < 2.5) {
    // Ribbed metal cladding with a darker base course and occasional high-level strip windows.
    float rib = 0.5 + 0.5 * sin(v_uv.x * 6.2832 / 1.1);
    base *= 0.92 + 0.08 * mix(0.5, rib, detail(1.1));
    base = mix(base, base * 0.7, step(v_uv.y, 1.0));
    float strip = step(top * 0.62, v_uv.y) * step(v_uv.y, top * 0.62 + 1.2) * step(0.5, hash(vec2(floor(v_uv.x / 24.0), seed)));
    base = mix(base, vec3(0.13, 0.17, 0.22), strip * 0.85);
    emissive = strip * night * vec3(0.9, 0.95, 1.0) * 0.45;
    glass = strip;
    gloss = 0.25;
  } else if (id < 3.5) {
    // Flat roof: membrane panels, rooftop plant and, on big roofs, skylight strips.
    vec2 p = v_uv;
    float k = detail(7.0);
    base *= 0.93 + 0.09 * mix(0.5, hash(floor(p / 7.0) + seed * 13.0), k);
    vec2 g = fract(p / 13.0);
    float unit = step(0.86, hash(floor(p / 13.0) + seed * 7.0)) * step(0.3, g.x) * step(g.x, 0.62) * step(0.3, g.y) * step(g.y, 0.62);
    base = mix(base, vec3(0.5, 0.52, 0.55), unit * 0.75 * detail(4.0));
    float sky = step(0.5, seed) * step(0.44, fract(p.x / 18.0)) * step(fract(p.x / 18.0), 0.56) * step(0.15, fract(p.y / 30.0));
    sky *= step(0.82, v_color.r) * detail(2.2);
    base = mix(base, vec3(0.3, 0.42, 0.5), sky * 0.8);
    emissive = sky * night * vec3(1.0, 0.9, 0.7) * 0.35;
  } else if (id < 4.5) {
    // Standing-seam metal roof.
    base *= 1.0 - 0.13 * step(0.9, fract(v_uv.x / 1.5)) * detail(1.5);
    gloss = 0.35;
  } else if (id < 5.5) {
    // Plain painted / concrete surface.
  } else if (id < 6.5) {
    // Tower cab: tinted glass with frames.
    float frame = step(fract(v_uv.x / 2.2), 0.07) * detail(2.2);
    base = mix(vec3(0.07, 0.13, 0.15), vec3(0.8), frame);
    emissive = (1.0 - frame) * night * vec3(0.5, 0.75, 0.7) * 0.22;
    glass = 1.0 - frame;
  } else if (id < 7.5) {
    // Jet bridge: a window strip along the sides.
    float strip = step(4.7, v_uv.y) * step(v_uv.y, 5.9) * step(0.08, fract(v_uv.x / 1.6));
    base = mix(base, vec3(0.12, 0.16, 0.2), strip);
    emissive = strip * night * vec3(1.0, 0.9, 0.7) * 0.5;
    glass = strip;
  } else {
    // Multi-storey car park: open decks between concrete spandrels.
    float deck = mix(0.58, step(0.42, fract(v_uv.y / 3.0)), detail(3.0));
    base = mix(base, vec3(0.08, 0.08, 0.09), deck * 0.85);
    emissive = deck * night * vec3(1.0, 0.92, 0.75) * 0.28 * step(0.3, hash(vec2(floor(v_uv.x / 6.0), floor(v_uv.y / 3.0))));
  }

  // Daylight: sun + sky. Night: faint moonlight plus the floodlit glow of an airport.
  vec3 L = czm_lightDirectionEC;
  float ndl = max(dot(N, L), 0.0);
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.36), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.28, sunElev)) * day;
  vec3 skyCol = mix(vec3(0.34, 0.37, 0.43), vec3(0.6, 0.68, 0.8), 0.5 + 0.5 * upness) * (0.06 + 0.94 * day);
  vec3 col = base * (skyCol * 0.5 + sunCol * ndl * 0.58);
  col += base * night * vec3(1.0, 0.86, 0.66) * (0.10 + 0.07 * (1.0 - abs(upness)));

  // Glass reflects the sky (more at grazing angles) and the sun.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 skyRefl = mix(vec3(0.5, 0.63, 0.8), vec3(0.86, 0.9, 0.95), fres) * (0.05 + 0.95 * day);
  col = mix(col, skyRefl, glass * (0.22 + 0.5 * fres));
  vec3 H = normalize(L + V);
  col += sunCol * pow(max(dot(N, H), 0.0), 64.0) * (glass * 0.9 + gloss * 0.4) * step(0.0, dot(N, L));

  col += emissive;
  out_FragColor = czm_gammaCorrect(vec4(col, 1.0));
}
`;

let appearance: Appearance | undefined;
function facadeAppearance(): Appearance {
  appearance ??= new Appearance({
    translucent: false,
    closed: true,
    // Opaque, closed geometry: depth-tested with back faces culled (1029 = WebGL BACK).
    renderState: { depthTest: { enabled: true }, depthMask: true, cull: { enabled: true, face: 1029 } },
    vertexShaderSource: VS,
    fragmentShaderSource: FS,
  });
  return appearance;
}

/** World-space primitive for an airport mesh standing on `baseM` (height of the airfield surface). */
export function createAirportPrimitive(mesh: AirportMesh, origin: [number, number], baseM: number, shadows: boolean): Primitive | undefined {
  const n = mesh.position.length / 3;
  if (!n || !mesh.index.length) return undefined;
  const positions = new Float64Array(n * 3);
  const normals = new Float32Array(n * 3);
  // Per-vertex geodetic placement (a tangent plane would lift far corners of a 10 km airfield by metres).
  const scratch = new Cartesian3();
  for (let i = 0; i < n; i++) {
    const ll = toLatLon(origin, mesh.position[i * 3], mesh.position[i * 3 + 1]);
    Cartesian3.fromDegrees(ll.lon, ll.lat, baseM + mesh.position[i * 3 + 2], undefined, scratch);
    positions[i * 3] = scratch.x;
    positions[i * 3 + 1] = scratch.y;
    positions[i * 3 + 2] = scratch.z;
  }
  const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(origin[1], origin[0], baseM));
  const rot = Matrix4.getMatrix3(enu, new Matrix3());
  const nrm = new Cartesian3();
  for (let i = 0; i < n; i++) {
    Cartesian3.fromElements(mesh.normal[i * 3], mesh.normal[i * 3 + 1], mesh.normal[i * 3 + 2], nrm);
    Matrix3.multiplyByVector(rot, nrm, nrm);
    normals[i * 3] = nrm.x;
    normals[i * 3 + 1] = nrm.y;
    normals[i * 3 + 2] = nrm.z;
  }
  const attributes = {
    position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
    normal: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: normals }),
    st: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: mesh.uv }),
    aColor: new GeometryAttribute({ componentDatatype: ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 3, normalize: true, values: mesh.color }),
    aMat: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: mesh.mat }),
  } as unknown as GeometryAttributes;
  const geometry = new Geometry({
    attributes,
    indices: mesh.index,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(positions as unknown as number[]),
  });
  return new Primitive({
    geometryInstances: new GeometryInstance({ geometry }),
    appearance: facadeAppearance(),
    asynchronous: false,
    compressVertices: false,
    allowPicking: false,
    shadows: shadows ? ShadowMode.CAST_ONLY : ShadowMode.DISABLED,
  });
}
