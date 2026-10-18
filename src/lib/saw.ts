import { ShapeUtils, Vector2 } from "three";
import { cutToPlane } from "./geometry/cuts";
import { clipFace } from "./geometry/clip";
import { faceNormal } from "./geometry/solids";
import { dot, planeBasis, sub } from "./geometry/vec3";
import type { Plane, Polyhedron, Vec3 } from "./geometry/types";
import type { ResolvedCut } from "./schema";

export type SawPoint = [number, number];
const EPS = 1e-6;
const cross = (a: SawPoint, b: SawPoint, c: SawPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const distance = (a: SawPoint, b: SawPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const sawArea = (points: SawPoint[]) => Math.abs(points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

export function onSawSegment(p: SawPoint, a: SawPoint, b: SawPoint): boolean {
  return Math.abs(cross(a, b, p)) < EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
function intersects(a: SawPoint, b: SawPoint, c: SawPoint, d: SawPoint): boolean {
  return (cross(a, b, c) * cross(a, b, d) < -EPS && cross(c, d, a) * cross(c, d, b) < -EPS) ||
    onSawSegment(a, c, d) || onSawSegment(b, c, d) || onSawSegment(c, a, b) || onSawSegment(d, a, b);
}
export function validateSawOutline(points: SawPoint[], size: Vec3): void {
  if (points.length < 3 || sawArea(points) < EPS) throw new Error("The cut must leave a shape with area.");
  points.forEach((p, i) => {
    if (!p.every(Number.isFinite) || p[0] < -EPS || p[1] < -EPS || p[0] > size[0] + EPS || p[1] > size[1] + EPS) throw new Error("Cut points must stay inside the stock.");
    const next = points[(i + 1) % points.length];
    if (distance(p, next) < EPS) throw new Error("Cut points must be distinct.");
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(p, next, points[j], points[(j + 1) % points.length])) throw new Error("Cut lines must not cross themselves.");
    }
  });
}
export function insideSawOutline(p: SawPoint, points: SawPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (onSawSegment(p, a, b)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Direction is fixed first; landmark snaps are accepted only on that direction. */
export function snapSawPoint(raw: SawPoint, start: SawPoint | undefined, outline: SawPoint[], step: number, threshold: number): SawPoint {
  const landmarks = outline.flatMap((p, i) => {
    const q = outline[(i + 1) % outline.length];
    return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as SawPoint];
  });
  if (!start) {
    let best: SawPoint = [Math.round(raw[0] / step) * step, Math.round(raw[1] / step) * step];
    let closest = threshold;
    for (const p of landmarks) if (distance(raw, p) < closest) { best = p; closest = distance(raw, p); }
    if (closest < threshold) return best;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((best[0] - a[0]) * dx + (best[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      const p: SawPoint = [a[0] + dx * t, a[1] + dy * t];
      if (distance(raw, p) < closest) { best = p; closest = distance(raw, p); }
    }
    return best;
  }
  const angle = Math.round(Math.atan2(raw[1] - start[1], raw[0] - start[0]) / (Math.PI / 4)) * Math.PI / 4;
  // Integer direction keeps diagonal runs on the same dimension grid as straight runs.
  const dir: SawPoint = [Math.round(Math.cos(angle)), Math.round(Math.sin(angle))];
  const norm = dir[0] ** 2 + dir[1] ** 2;
  const t = Math.max(0, ((raw[0] - start[0]) * dir[0] + (raw[1] - start[1]) * dir[1]) / norm);
  const projected: SawPoint = [start[0] + t * dir[0], start[1] + t * dir[1]];
  // Every intersection of the constrained ray and an edge is an eligible boundary landmark.
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const edge: SawPoint = [b[0] - a[0], b[1] - a[1]];
    const denom = dir[0] * edge[1] - dir[1] * edge[0];
    if (Math.abs(denom) < EPS) continue;
    const at = ((a[0] - start[0]) * edge[1] - (a[1] - start[1]) * edge[0]) / denom;
    const p: SawPoint = [start[0] + at * dir[0], start[1] + at * dir[1]];
    if (at > EPS && onSawSegment(p, a, b)) landmarks.push(p);
  }
  let result: SawPoint = [start[0] + Math.round(t / step) * step * dir[0], start[1] + Math.round(t / step) * step * dir[1]];
  let closest = threshold;
  for (const p of landmarks) {
    if (distance(p, start) < EPS || Math.abs(cross(start, projected, p)) > EPS) continue;
    if (distance(projected, p) < closest) { result = p; closest = distance(projected, p); }
  }
  return result;
}

/** Split a simple outline with a simple edge-to-edge pen stroke. */
export function splitSawOutline(outline: SawPoint[], path: SawPoint[]): [SawPoint[], SawPoint[]] {
  if (path.length < 2) throw new Error("Draw a cut from one edge to another.");
  const first = path[0], last = path[path.length - 1];
  if (distance(first, last) < EPS) throw new Error("Finish the cut on a different edge point.");
  const boundary: SawPoint[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    boundary.push(a);
    [first, last].filter(p => onSawSegment(p, a, b) && distance(p, a) > EPS && distance(p, b) > EPS)
      .sort((p, q) => distance(p, a) - distance(q, a)).forEach(p => boundary.push(p));
  }
  const from = boundary.findIndex(p => distance(p, first) < EPS), to = boundary.findIndex(p => distance(p, last) < EPS);
  if (from < 0 || to < 0) throw new Error("Start and finish the cut on the member’s edge.");
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    if (!insideSawOutline([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], outline)) throw new Error("Keep the cut inside the member.");
    for (let j = 0; j < outline.length; j++) {
      const c = outline[j], d = outline[(j + 1) % outline.length];
      if (intersects(a, b, c, d) && !(i === 0 && onSawSegment(first, c, d)) && !(i === path.length - 2 && onSawSegment(last, c, d))) throw new Error("The cut crosses another edge. Finish at the first edge you reach.");
    }
  }
  const walk = (a: number, b: number): SawPoint[] => {
    const points = [boundary[a]];
    for (let i = (a + 1) % boundary.length; i !== b; i = (i + 1) % boundary.length) points.push(boundary[i]);
    points.push(boundary[b]);
    return points;
  };
  const pieces: [SawPoint[], SawPoint[]] = [
    [...walk(from, to), ...path.slice(1, -1).reverse()],
    [...walk(to, from), ...path.slice(1, -1)],
  ];
  for (const piece of pieces) validateSawOutline(piece, [Infinity, Infinity, 1]);
  if (Math.abs(sawArea(pieces[0]) + sawArea(pieces[1]) - sawArea(outline)) > 1e-4) throw new Error("The cut must stay inside the member without crossing itself.");
  return pieces;
}

export function sawPrism(outline: SawPoint[], thickness: number): Polyhedron {
  const points = outline.map(p => new Vector2(...p));
  if (ShapeUtils.isClockWise(points)) points.reverse();
  const base = points.map(p => [p.x, 0, p.y] as Vec3);
  const top = points.map(p => [p.x, thickness, p.y] as Vec3);
  const faces: Polyhedron = [];
  for (const tri of ShapeUtils.triangulateShape(points, [])) {
    faces.push(tri.map(i => base[i]), tri.toReversed().map(i => top[i]));
  }
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    faces.push([base[i], top[i], top[next], base[next]]);
  }
  return faces;
}

/** Clip a triangulated, potentially concave solid. Stitch cap loops instead of sorting around a centroid. */
function clipSawSolid(poly: Polyhedron, plane: Plane): Polyhedron {
  const faces: Polyhedron = [];
  const segments: [Vec3, Vec3][] = [];
  const same = (a: Vec3, b: Vec3) => Math.hypot(...sub(a, b)) < EPS;
  for (const face of poly) {
    const { polygon, intersections } = clipFace(face, plane);
    if (polygon.length >= 3) faces.push(polygon);
    const unique = intersections.filter((p, i) => !intersections.slice(0, i).some(q => same(p, q)));
    if (unique.length === 2) segments.push([unique[0], unique[1]]);
  }
  const { u, v } = planeBasis(plane.normal);
  while (segments.length) {
    const loop = [...segments.pop()!];
    while (!same(loop[0], loop[loop.length - 1])) {
      const end = loop[loop.length - 1];
      const index = segments.findIndex(([a, b]) => same(a, end) || same(b, end));
      if (index < 0) throw new Error("Could not close the cut surface.");
      const [a, b] = segments.splice(index, 1)[0];
      loop.push(same(a, end) ? b : a);
    }
    loop.pop();
    if (loop.length < 3) continue;
    const points = loop.map(p => new Vector2(dot(p, u), dot(p, v)));
    for (const tri of ShapeUtils.triangulateShape(points, [])) {
      const face = tri.map(i => loop[i]);
      if (dot(faceNormal(face), plane.normal) < 0) face.reverse();
      faces.push(face);
    }
  }
  return faces;
}
export function applySawOutline(size: Vec3, outline: SawPoint[], cuts: ResolvedCut[]): Polyhedron {
  validateSawOutline(outline, size);
  let poly = sawPrism(outline, size[2]);
  for (const cut of cuts) poly = clipSawSolid(poly, cutToPlane(cut, size));
  return poly;
}

/** Recover the visible broad-face perimeter, removing triangulation seams. */
export function sawSurface(faces: Polyhedron): { outline: SawPoint[]; y: number } {
  const vertices = faces.flat();
  const y = Math.max(...vertices.map(p => p[1]));
  const bottom = Math.min(...vertices.map(p => p[1]));
  const top = vertices.filter(p => Math.abs(p[1] - y) < EPS);
  const low = vertices.filter(p => Math.abs(p[1] - bottom) < EPS);
  if (vertices.some(p => Math.abs(p[1] - y) > EPS && Math.abs(p[1] - bottom) > EPS) ||
    top.some(p => !low.some(q => Math.hypot(p[0] - q[0], p[2] - q[2]) < EPS)) ||
    low.some(p => !top.some(q => Math.hypot(p[0] - q[0], p[2] - q[2]) < EPS))) {
    throw new Error("The saw tool needs a flat board or sheet without thickness bevels.");
  }
  const edges: [SawPoint, SawPoint][] = [];
  for (const face of faces) {
    if (!face.every(p => Math.abs(p[1] - y) < EPS)) continue;
    for (let i = 0; i < face.length; i++) {
      const p = face[i], q = face[(i + 1) % face.length];
      const a: SawPoint = [p[0], p[2]], b: SawPoint = [q[0], q[2]];
      const match = edges.findIndex(([c, d]) => distance(a, d) < EPS && distance(b, c) < EPS);
      if (match >= 0) edges.splice(match, 1); else if (distance(a, b) > EPS) edges.push([a, b]);
    }
  }
  if (!edges.length) throw new Error("Select a flat board or sheet to cut.");
  const outline = [...edges.pop()!];
  while (distance(outline[0], outline[outline.length - 1]) > EPS) {
    const index = edges.findIndex(([a]) => distance(a, outline[outline.length - 1]) < EPS);
    if (index < 0) throw new Error("Could not trace this member’s edge.");
    outline.push(edges.splice(index, 1)[0][1]);
  }
  if (edges.length) throw new Error("Cut one connected piece at a time.");
  outline.pop();
  // Clipped triangles can leave collinear points on the perimeter.
  let changed = true;
  while (changed && outline.length > 3) {
    changed = false;
    for (let i = 0; i < outline.length; i++) {
      if (Math.abs(cross(outline[(i + outline.length - 1) % outline.length], outline[i], outline[(i + 1) % outline.length])) < EPS) {
        outline.splice(i, 1); changed = true; break;
      }
    }
  }
  return { outline, y };
}
