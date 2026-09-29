import { add, applyPose, dot, len, NEAR_REACH, scale, sub, type Vec3 } from "./geometry";
import type { SceneModel } from "./scene";

/** Part dimensions longer than this are labelled in measurement mode. */
export const MIN_LABEL_INCHES = 12;

const PARALLEL = 1e-8;

export type MemberDimension = {
  memberKey: string;
  label: string;
  /** Cut axis: 0 = L, 1 = W, 2 = T. */
  axis: 0 | 1 | 2;
  length: number;
  worldStart: Vec3;
  worldEnd: Vec3;
  worldDirection: Vec3;
  /** Closest world axis: 0 = X, 1 = Y, 2 = Z. */
  worldAxis: 0 | 1 | 2;
  badgePosition: Vec3;
};

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

const AXIS_COORD = [0, 2, 1] as const;
const AXIS_DIR: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Push dimension lines off the stock corner so they sit outside the part. */
const LINE_OUT = 1.25;
/** Extra push so the size badge clears the line. */
const BADGE_OUT = 2;

/**
 * World axis with the largest component. Ties resolve toward X, then Y, then Z.
 */
export function dominantWorldAxis(direction: Vec3): 0 | 1 | 2 {
  const ax = Math.abs(direction[0]);
  const ay = Math.abs(direction[1]);
  const az = Math.abs(direction[2]);
  if (ax >= ay && ax >= az) return 0;
  if (ay >= az) return 1;
  return 2;
}

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

export function dimensionId(dimension: MemberDimension): string {
  return `${dimension.memberKey}:${dimension.axis}`;
}

/**
 * Dimension of `scene` longer than `minInches`, in world space.
 * `worldOffsets` are explode shifts keyed by member instance.
 */
export function extractSceneDimensions(
  scene: SceneModel,
  worldOffsets: Map<string, Vec3>,
  minInches = MIN_LABEL_INCHES,
): MemberDimension[] {
  const dimensions: MemberDimension[] = [];
  for (const component of scene.components) {
    for (const member of component.members) {
      const offset = worldOffsets.get(member.key) ?? [0, 0, 0];
      for (const axis of [0, 1, 2] as const) {
        const dimension = memberDimension(member, component, axis, offset, minInches);
        if (dimension) dimensions.push(dimension);
      }
    }
  }
  return dimensions;
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

function memberDimension(
  member: SceneModel["components"][number]["members"][number],
  component: { position: Vec3; rotation: Vec3 },
  axis: 0 | 1 | 2,
  worldOffset: Vec3,
  minInches: number,
): MemberDimension | null {
  const { min, max } = member.bounds;
  const coord = AXIS_COORD[axis];
  const extent = max[coord] - min[coord];
  if (!(extent > minInches)) return null;

  const edge = edgeInLocal(min, max, axis);
  const worldStart = toWorld(edge.start, member, component, worldOffset);
  const worldEnd = toWorld(edge.end, member, component, worldOffset);
  const delta = sub(worldEnd, worldStart);
  const length = len(delta);
  if (!(length > minInches)) return null;
  const worldDirection = scale(delta, 1 / length);
  return {
    memberKey: member.key,
    label: member.label,
    axis,
    length,
    worldStart,
    worldEnd,
    worldDirection,
    worldAxis: dominantWorldAxis(worldDirection),
    badgePosition: toWorld(edge.badge, member, component, worldOffset),
  };
}

function edgeInLocal(
  min: Vec3,
  max: Vec3,
  axis: 0 | 1 | 2,
): { start: Vec3; end: Vec3; badge: Vec3 } {
  if (axis === 0) {
    const y = max[1] + LINE_OUT;
    const z = max[2] + LINE_OUT;
    const start: Vec3 = [min[0], y, z];
    const end: Vec3 = [max[0], y, z];
    return { start, end, badge: offsetBadge(start, end, [0, 1, 1]) };
  }
  if (axis === 1) {
    const x = max[0] + LINE_OUT;
    const y = max[1] + LINE_OUT;
    const start: Vec3 = [x, y, min[2]];
    const end: Vec3 = [x, y, max[2]];
    return { start, end, badge: offsetBadge(start, end, [1, 1, 0]) };
  }
  const x = max[0] + LINE_OUT;
  const z = max[2] + LINE_OUT;
  const start: Vec3 = [x, min[1], z];
  const end: Vec3 = [x, max[1], z];
  return { start, end, badge: offsetBadge(start, end, [1, 0, 1]) };
}

function offsetBadge(start: Vec3, end: Vec3, outward: Vec3): Vec3 {
  const mid: Vec3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
  const n = len(outward);
  if (n < PARALLEL) return mid;
  return add(mid, scale(outward, BADGE_OUT / n));
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
