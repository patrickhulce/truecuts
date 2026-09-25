import { BOX_FACE_ORDER, faceQuad } from "./faces";
import type { Face, Polyhedron, Vec3 } from "./types";
import { add, cross, dot, normalize, sub, uniquePoints } from "./vec3";

export function faceNormal(face: Face): Vec3 {
  if (face.length < 3) return [0, 0, 0];
  return normalize(cross(sub(face[1], face[0]), sub(face[2], face[0])));
}

export function boxPolyhedron(size: Vec3): Polyhedron {
  return BOX_FACE_ORDER.map((id) => faceQuad(id, size));
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
 * Flat L-bracket: a single-plane L between `LxW@0` and `LxW@1` (the XZ plane).
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

/**
 * Post-to-beam T. Bed plate is L×W×T on `LxW@0`. The stem is centered across W,
 * gauge T, and rises `riser` along +Y. `riser` is not copied from L or W.
 * Origin at the outside corner of the bed, same convention as an L-bracket.
 */
export function tConnectorPolyhedron(size: Vec3, riser: number): Polyhedron {
  const [length, width, thickness] = size;
  const stemZ = Math.max((width - thickness) / 2, 0);
  return [
    ...boxPolyhedron([length, width, thickness]),
    ...boxPolyhedronAt([0, 0, stemZ], [length, thickness, riser]),
  ];
}

const ROD_SEGMENTS = 16;

/**
 * Round rod: a 16-side prism along L, inscribed in the W×T square.
 * Diameter is the smaller of W and T, so a 1″ rod stays 1″ across when it gets longer.
 * Cardinal vertices sit on the square, so the bounding box is `size` when W and T match.
 */
export function rodPolyhedron(size: Vec3): Polyhedron {
  const [length, width, thickness] = size;
  const radius = Math.min(width, thickness) / 2;
  const centerY = thickness / 2;
  const centerZ = width / 2;
  const ring = (x: number): Vec3[] =>
    Array.from({ length: ROD_SEGMENTS }, (_, index) => {
      const theta = (index / ROD_SEGMENTS) * Math.PI * 2;
      return [x, centerY + radius * Math.sin(theta), centerZ + radius * Math.cos(theta)];
    });
  const start = ring(0);
  const end = ring(length);
  const faces: Polyhedron = [];

  const startCap = [...start];
  if (faceNormal(startCap)[0] > 0) startCap.reverse();
  faces.push(startCap);

  const endCap = [...end];
  if (faceNormal(endCap)[0] < 0) endCap.reverse();
  faces.push(endCap);

  for (let index = 0; index < ROD_SEGMENTS; index++) {
    const next = (index + 1) % ROD_SEGMENTS;
    let quad: Face = [start[index], end[index], end[next], start[next]];
    const outward: Vec3 = [
      0,
      (start[index][1] + start[next][1]) / 2 - centerY,
      (start[index][2] + start[next][2]) / 2 - centerZ,
    ];
    if (dot(faceNormal(quad), outward) < 0) {
      quad = [start[index], start[next], end[next], end[index]];
    }
    faces.push(quad);
  }
  return faces;
}

/**
 * U-saddle. Seat is L long and T thick; the clear opening is W. Flanges of
 * gauge T rise `flange` along +Y at each edge of that opening. `flange` is
 * not copied from W. Origin at the outside corner of the seat.
 */
export function saddlePolyhedron(size: Vec3, flange: number): Polyhedron {
  const [length, width, thickness] = size;
  const outer = width + 2 * thickness;
  return [
    ...boxPolyhedron([length, outer, thickness]),
    ...boxPolyhedronAt([0, 0, 0], [length, thickness, flange]),
    ...boxPolyhedronAt([0, 0, thickness + width], [length, thickness, flange]),
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
