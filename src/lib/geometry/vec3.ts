import type { Vec3 } from "./types";

export const EPS = 1e-8;

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

export function uniquePoints(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    if (!out.some((q) => len(sub(p, q)) < 1e-6)) {
      out.push(p);
    }
  }
  return out;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Orthonormal tangent frame for a unit normal. */
export function planeBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const n = normalize(normal);
  const tmp: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(n, tmp));
  const v = cross(n, u);
  return { u, v };
}
