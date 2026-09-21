import { faceNormal } from "./solids";
import type { Face, Plane, Vec3 } from "./types";
import { add, cross, dot, EPS, lerp, normalize, planeBasis, scale, sub } from "./vec3";

export type Vec2 = [number, number];

export { planeBasis };

export function toPlane2D(point: Vec3, origin: Vec3, u: Vec3, v: Vec3): Vec2 {
  const d = sub(point, origin);
  return [dot(d, u), dot(d, v)];
}

export function fromPlane2D(p: Vec2, origin: Vec3, u: Vec3, v: Vec3): Vec3 {
  return add(origin, add(scale(u, p[0]), scale(v, p[1])));
}

export function convexArea2D(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

export function convexArea(face: Face, normal: Vec3): number {
  if (face.length < 3) return 0;
  const { u, v } = planeBasis(normal);
  return convexArea2D(face.map((p) => toPlane2D(p, face[0], u, v)));
}

export function centroid3(face: Face): Vec3 {
  if (face.length === 0) return [0, 0, 0];
  const s: Vec3 = [0, 0, 0];
  for (const p of face) {
    s[0] += p[0];
    s[1] += p[1];
    s[2] += p[2];
  }
  const n = face.length;
  return [s[0] / n, s[1] / n, s[2] / n];
}

function clipConvexByPlane(face: Face, plane: Plane): Face {
  const polygon: Face = [];
  if (face.length === 0) return polygon;

  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const da = dot(plane.normal, a) - plane.d;
    const db = dot(plane.normal, b) - plane.d;
    const aIn = da <= EPS;
    const bIn = db <= EPS;

    if (aIn && bIn) {
      polygon.push(b);
    } else if (aIn && !bIn) {
      const t = da / (da - db);
      polygon.push(lerp(a, b, t));
    } else if (!aIn && bIn) {
      const t = da / (da - db);
      polygon.push(lerp(a, b, t));
      polygon.push(b);
    }
  }

  return polygon;
}

const AREA_EPS = 1e-6;

/**
 * Intersection of two convex coplanar polygons.
 * `normal` is the shared face normal (winding of `b` should agree with it).
 */
export function intersectConvex(a: Face, b: Face, normal: Vec3): Face | null {
  if (a.length < 3 || b.length < 3) return null;
  const n = normalize(normal);
  const clipper = dot(faceNormal(b), n) < 0 ? [...b].reverse() : b;
  let clipped = a;
  for (let i = 0; i < clipper.length; i++) {
    const start = clipper[i];
    const end = clipper[(i + 1) % clipper.length];
    const edge = sub(end, start);
    const inward = normalize(cross(n, edge));
    if (inward[0] === 0 && inward[1] === 0 && inward[2] === 0) continue;
    // clipConvexByPlane keeps n·x <= d; flip so the interior (inward · x >= d) remains.
    clipped = clipConvexByPlane(clipped, { normal: scale(inward, -1), d: -dot(inward, start) });
    if (clipped.length < 3) return null;
  }
  if (convexArea(clipped, n) < AREA_EPS) return null;
  return clipped;
}
