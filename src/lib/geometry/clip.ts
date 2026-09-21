import type { Face, Plane, Polyhedron, Vec3 } from "./types";
import { faceNormal } from "./solids";
import { dot, EPS, lerp, normalize, planeBasis, sub, uniquePoints } from "./vec3";

function classify(p: Vec3, plane: Plane): number {
  return dot(plane.normal, p) - plane.d;
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
  const { u, v } = planeBasis(n);
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
