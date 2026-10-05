import { add, applyPose, dot, len, NEAR_REACH, scale, sub, type Vec3 } from "./geometry";
import type { SceneModel } from "./scene";

const PARALLEL = 1e-8;

export type MeasureEdge = {
  a: Vec3;
  b: Vec3;
};

export type TapeReading = {
  axis: 0 | 1 | 2;
  start: Vec3;
  end: Vec3;
  distance: number;
  snapped: boolean;
};

const AXIS_DIR: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Scalar distance along `lineDir` from `lineStart` to the point on the line
 * closest to the camera ray. `lineDir` is unit length.
 */
export function projectRayToLine(rayOrigin: Vec3, rayDir: Vec3, lineStart: Vec3, lineDir: Vec3): number {
  const w = sub(rayOrigin, lineStart);
  const a = dot(rayDir, rayDir);
  const b = dot(rayDir, lineDir);
  const c = dot(lineDir, lineDir);
  const d = dot(rayDir, w);
  const e = dot(lineDir, w);
  if (c < PARALLEL) return 0;
  const denom = a * c - b * b;
  if (Math.abs(denom) < PARALLEL) return e / c;
  return (a * e - b * d) / denom;
}

/** Posed box corners and edges for every member, shifted by explode offsets. */
export function sceneMeasureTargets(
  scene: SceneModel,
  worldOffsets: Map<string, Vec3>,
): { corners: Vec3[]; edges: MeasureEdge[] } {
  const corners: Vec3[] = [];
  const edges: MeasureEdge[] = [];
  for (const component of scene.components) {
    for (const member of component.members) {
      const offset = worldOffsets.get(member.key) ?? [0, 0, 0];
      const { min, max } = member.bounds;
      const world = (local: Vec3) => toWorld(local, member, component, offset);
      const xs = [min[0], max[0]];
      const ys = [min[1], max[1]];
      const zs = [min[2], max[2]];
      for (const x of xs) {
        for (const y of ys) {
          for (const z of zs) corners.push(world([x, y, z]));
        }
      }
      for (const y of ys) {
        for (const z of zs) edges.push({ a: world([min[0], y, z]), b: world([max[0], y, z]) });
      }
      for (const x of xs) {
        for (const z of zs) edges.push({ a: world([x, min[1], z]), b: world([x, max[1], z]) });
      }
      for (const x of xs) {
        for (const y of ys) edges.push({ a: world([x, y, min[2]]), b: world([x, y, max[2]]) });
      }
    }
  }
  return { corners, edges };
}

/**
 * Point on the world axis through `start` whose line passes closest to the ray.
 * Ties go to the axis with more travel, so a diagonal drag follows the longer move.
 */
export function closestAxisPoint(
  start: Vec3,
  rayOrigin: Vec3,
  rayDir: Vec3,
): { axis: 0 | 1 | 2; coordinate: number; gap: number } | null {
  let best: { axis: 0 | 1 | 2; coordinate: number; gap: number; travel: number } | null = null;
  for (const axis of [0, 1, 2] as const) {
    const delta = projectRayToLine(rayOrigin, rayDir, start, AXIS_DIR[axis]);
    const point = pointOnAxis(start, axis, start[axis] + delta);
    const gap = gapToRay(rayOrigin, rayDir, point);
    if (gap === null) continue;
    const travel = Math.abs(delta);
    if (
      !best ||
      gap < best.gap - 1e-4 ||
      (Math.abs(gap - best.gap) <= 1e-4 && travel > best.travel)
    ) {
      best = { axis, coordinate: start[axis] + delta, gap, travel };
    }
  }
  if (!best) return null;
  return { axis: best.axis, coordinate: best.coordinate, gap: best.gap };
}

/**
 * Pull `coordinate` onto a part edge within `reach` (the 2" boundary rule).
 * Edges that touch `start` are skipped so the tape does not collapse back to zero.
 */
export function snapCoordinateToEdges(
  start: Vec3,
  axis: 0 | 1 | 2,
  coordinate: number,
  edges: readonly MeasureEdge[],
  reach = NEAR_REACH,
): { coordinate: number; snapped: boolean } {
  const rawPoint = pointOnAxis(start, axis, coordinate);
  let bestDistance = reach;
  let best = coordinate;
  let snapped = false;
  for (const edge of edges) {
    if (len(sub(closestPointOnSegment(start, edge.a, edge.b), start)) < 1e-3) continue;
    const closest = closestPointOnSegment(rawPoint, edge.a, edge.b);
    const distance = len(sub(closest, rawPoint));
    if (distance > reach + 1e-6) continue;
    if (Math.abs(closest[axis] - start[axis]) < 1e-3) continue;
    if (!snapped || distance < bestDistance - 1e-4) {
      bestDistance = distance;
      best = closest[axis];
      snapped = true;
    }
  }
  return { coordinate: best, snapped };
}

/** Tape from `start` along the world axis closest to the ray, snapped to edges within 2". */
export function measureAlongAxes(
  start: Vec3,
  rayOrigin: Vec3,
  rayDir: Vec3,
  edges: readonly MeasureEdge[],
  reach = NEAR_REACH,
): TapeReading | null {
  const hit = closestAxisPoint(start, rayOrigin, rayDir);
  if (!hit) return null;
  const snapped = snapCoordinateToEdges(start, hit.axis, hit.coordinate, edges, reach);
  const end = pointOnAxis(start, hit.axis, snapped.coordinate);
  return {
    axis: hit.axis,
    start,
    end,
    distance: Math.abs(snapped.coordinate - start[hit.axis]),
    snapped: snapped.snapped,
  };
}

export function closestPointOnSegment(point: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const length2 = dot(ab, ab);
  if (length2 < PARALLEL) return a;
  const t = Math.min(1, Math.max(0, dot(sub(point, a), ab) / length2));
  return add(a, scale(ab, t));
}

function pointOnAxis(start: Vec3, axis: 0 | 1 | 2, coordinate: number): Vec3 {
  const point: Vec3 = [start[0], start[1], start[2]];
  point[axis] = coordinate;
  return point;
}

function gapToRay(rayOrigin: Vec3, rayDir: Vec3, point: Vec3): number | null {
  const w = sub(point, rayOrigin);
  const speed = dot(rayDir, rayDir);
  const t = speed < PARALLEL ? 0 : dot(w, rayDir) / speed;
  if (t < 0) return null;
  return len(sub(point, add(rayOrigin, scale(rayDir, t))));
}

function toWorld(
  local: Vec3,
  member: { position: Vec3; rotation: Vec3 },
  component: { position: Vec3; rotation: Vec3 },
  worldOffset: Vec3,
): Vec3 {
  return add(
    applyPose(applyPose(local, member.position, member.rotation), component.position, component.rotation),
    worldOffset,
  );
}
