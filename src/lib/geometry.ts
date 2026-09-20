import type { Axis, ResolvedCut } from "./schema";

export type Vec3 = [number, number, number];
export type Face = Vec3[];
export type Polyhedron = Face[];

/**
 * Map a cut/size axis (0=L, 1=W, 2=T) onto a local XYZ coordinate.
 * Default frame: L along +X, W along +Z, T along +Y.
 */
export const AXIS_TO_COORD = [0, 2, 1] as const;

export function axisCoord(axis: Axis): 0 | 1 | 2 {
  return AXIS_TO_COORD[axis];
}

export type Plane = {
  /** Keep the half-space n·x <= d. */
  normal: Vec3;
  d: number;
};

const EPS = 1e-8;

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  if (l < EPS) return [0, 0, 0];
  return scale(a, 1 / l);
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, scale(sub(b, a), t));
}

export function faceNormal(face: Face): Vec3 {
  if (face.length < 3) return [0, 0, 0];
  return normalize(cross(sub(face[1], face[0]), sub(face[2], face[0])));
}

export function boxPolyhedron(size: Vec3): Polyhedron {
  const [l, w, t] = size;
  const v: Vec3[] = [
    [0, 0, 0],
    [l, 0, 0],
    [l, 0, w],
    [0, 0, w],
    [0, t, 0],
    [l, t, 0],
    [l, t, w],
    [0, t, w],
  ];
  return [
    [v[0], v[1], v[2], v[3]],
    [v[4], v[7], v[6], v[5]],
    [v[0], v[4], v[5], v[1]],
    [v[3], v[2], v[6], v[7]],
    [v[0], v[3], v[7], v[4]],
    [v[1], v[5], v[6], v[2]],
  ];
}

/** Axis-aligned box with min-corner `origin` and size `size`. */
export function boxPolyhedronAt(origin: Vec3, size: Vec3): Polyhedron {
  return boxPolyhedron(size).map((face) => face.map((point) => add(point, origin)));
}

/**
 * L-bracket: flange A in XZ (thin +Y), flange B rising along +Y (thin +X).
 * `size` is [flange length along +X, fold width along +Z, thickness along +Y].
 * The second flange runs the same length along +Y. Origin at the inside corner.
 */
export function lBracketPolyhedron(size: Vec3): Polyhedron {
  const [leg, fold, thickness] = size;
  return [...boxPolyhedron([leg, fold, thickness]), ...boxPolyhedronAt([0, 0, 0], [thickness, fold, leg])];
}

/**
 * Flat L-bracket: a single-plane L in the XZ (L×W) plane.
 * `size` is [leg length along +X/+Z, arm width, thickness along +Y].
 * Origin at the outer corner; both legs run from that corner.
 */
export function flatLBracketPolyhedron(size: Vec3): Polyhedron {
  const [leg, arm, thickness] = size;
  return [
    ...boxPolyhedron([leg, arm, thickness]),
    ...boxPolyhedronAt([0, 0, arm], [arm, Math.max(leg - arm, 0), thickness]),
  ];
}

function classify(p: Vec3, plane: Plane): number {
  return dot(plane.normal, p) - plane.d;
}

function uniquePoints(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    if (!out.some((q) => len(sub(p, q)) < 1e-6)) {
      out.push(p);
    }
  }
  return out;
}

function orderCap(points: Vec3[], normal: Vec3): Face {
  const uniq = uniquePoints(points);
  if (uniq.length < 3) return [];
  const centroid: Vec3 = [
    uniq.reduce((s, p) => s + p[0], 0) / uniq.length,
    uniq.reduce((s, p) => s + p[1], 0) / uniq.length,
    uniq.reduce((s, p) => s + p[2], 0) / uniq.length,
  ];
  const n = normalize(normal);
  const tmp: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(n, tmp));
  const v = cross(n, u);
  const sorted = uniq
    .map((p) => {
      const d = sub(p, centroid);
      return { p, angle: Math.atan2(dot(d, v), dot(d, u)) };
    })
    .sort((a, b) => a.angle - b.angle)
    .map((item) => item.p);
  if (dot(faceNormal(sorted), n) < 0) {
    sorted.reverse();
  }
  return sorted;
}

function clipFace(face: Face, plane: Plane): { polygon: Face; intersections: Vec3[] } {
  const polygon: Face = [];
  const intersections: Vec3[] = [];
  if (face.length === 0) return { polygon, intersections };

  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const da = classify(a, plane);
    const db = classify(b, plane);
    const aIn = da <= EPS;
    const bIn = db <= EPS;

    if (aIn && bIn) {
      polygon.push(b);
    } else if (aIn && !bIn) {
      const t = da / (da - db);
      const x = lerp(a, b, t);
      polygon.push(x);
      intersections.push(x);
    } else if (!aIn && bIn) {
      const t = da / (da - db);
      const x = lerp(a, b, t);
      polygon.push(x);
      polygon.push(b);
      intersections.push(x);
    }
  }

  return { polygon, intersections };
}

/** Clip a convex polyhedron to the half-space n·x <= d, adding a cap face. */
export function clipPolyhedron(poly: Polyhedron, plane: Plane): Polyhedron {
  const faces: Face[] = [];
  const capPoints: Vec3[] = [];

  for (const face of poly) {
    const { polygon, intersections } = clipFace(face, plane);
    capPoints.push(...intersections);
    if (polygon.length >= 3) {
      faces.push(polygon);
    }
  }

  const cap = orderCap(capPoints, plane.normal);
  if (cap.length >= 3) {
    faces.push(cap);
  }

  return faces;
}

/** Default miter is parallel to the T axis (2), spanning W. When cutting on T, span W (1). */
export function defaultAround(cutAxis: Axis): Axis {
  return cutAxis === 2 ? 1 : 2;
}

export function cutToPlane(cut: ResolvedCut, size: Vec3): Plane {
  const axis = cut.axis;
  const around = cut.around ?? defaultAround(axis);
  const spanAxis = ([0, 1, 2] as Axis[]).find((a) => a !== axis && a !== around);
  if (spanAxis === undefined) {
    throw new Error("`around` must be different from the cut axis");
  }

  const axisXyz = axisCoord(axis);
  const aroundXyz = axisCoord(around);
  const spanXyz = axisCoord(spanAxis);

  const square = Math.abs(cut.angle - 90) < 1e-6 || typeof cut.at === "number";
  if (square) {
    const at = cut.at as number;
    const n: Vec3 = [0, 0, 0];
    n[axisXyz] = 1;
    let d = at;
    if (cut.side === "start") {
      n[axisXyz] = -1;
      d = -at;
    }
    return { normal: n, d };
  }

  const [short, long] = cut.at as [number, number];
  const pShort: Vec3 = [0, 0, 0];
  pShort[axisXyz] = short;
  const pLong: Vec3 = [0, 0, 0];
  pLong[axisXyz] = long;
  pLong[spanXyz] = size[spanAxis];
  const p3: Vec3 = [...pShort];
  p3[aroundXyz] = (size[around] || 1) + 1;

  let n = normalize(cross(sub(pLong, pShort), sub(p3, pShort)));
  if (n[axisXyz] < 0) n = scale(n, -1);
  let d = dot(n, pShort);
  if (cut.side === "start") {
    n = scale(n, -1);
    d = -d;
  }
  return { normal: n, d };
}

export function applyCuts(size: Vec3, cuts: ResolvedCut[]): Polyhedron {
  let poly = boxPolyhedron(size);
  for (const cut of cuts) {
    poly = clipPolyhedron(poly, cutToPlane(cut, size));
  }
  return poly;
}

export function boundingBox(poly: Polyhedron): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const face of poly) {
    for (const p of face) {
      min[0] = Math.min(min[0], p[0]);
      min[1] = Math.min(min[1], p[1]);
      min[2] = Math.min(min[2], p[2]);
      max[0] = Math.max(max[0], p[0]);
      max[1] = Math.max(max[1], p[1]);
      max[2] = Math.max(max[2], p[2]);
    }
  }
  return { min, max };
}

export function polyhedronVolume(poly: Polyhedron): number {
  let volume = 0;
  for (const face of poly) {
    for (let i = 1; i < face.length - 1; i++) {
      volume += dot(face[0], cross(face[i], face[i + 1]));
    }
  }
  return Math.abs(volume) / 6;
}

export function vertexCount(poly: Polyhedron): number {
  return uniquePoints(poly.flat()).length;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Rotate `v` by Euler XYZ in degrees (same convention as THREE.Euler default).
 * THREE applies Rz then Ry then Rx (matrix Rx Ry Rz on column vectors).
 */
export function rotateEulerXYZ(v: Vec3, rotationDeg: Vec3): Vec3 {
  const rx = degToRad(rotationDeg[0]);
  const ry = degToRad(rotationDeg[1]);
  const rz = degToRad(rotationDeg[2]);
  let x = v[0];
  let y = v[1];
  let z = v[2];

  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x1 = x * cz - y * sz;
  const y1 = x * sz + y * cz;
  x = x1;
  y = y1;

  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const x2 = x * cy + z * sy;
  const z2 = -x * sy + z * cy;
  x = x2;
  z = z2;

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const y3 = y * cx - z * sx;
  const z3 = y * sx + z * cx;
  return [x, y3, z3];
}

export function applyPose(point: Vec3, position: Vec3, rotationDeg: Vec3): Vec3 {
  return add(rotateEulerXYZ(point, rotationDeg), position);
}
