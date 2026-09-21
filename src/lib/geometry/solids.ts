import type { Face, Polyhedron, Vec3 } from "./types";
import { add, cross, dot, normalize, sub, uniquePoints } from "./vec3";

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
