import { applyPose, unapplyPose } from "./pose";
import type { Vec3 } from "./types";

export type Aabb = { min: Vec3; max: Vec3 };

/** Inches. Members this close count as neighbors, and a drag may snap to their boundary. */
export const NEAR_REACH = 2;

const DISTINCT_EPS = 1e-3;

function corners(box: Aabb): Vec3[] {
  const points: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) points.push([x, y, z]);
    }
  }
  return points;
}

function enclose(points: Vec3[]): Aabb {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

/** Gap between two boxes on one axis. Zero when the intervals overlap or touch. */
export function aabbGap(a: Aabb, b: Aabb, axis: 0 | 1 | 2): number {
  return Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0);
}

/** Euclidean gap between two boxes. Zero when they overlap or touch. */
export function aabbDistance(a: Aabb, b: Aabb): number {
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) {
    const gap = aabbGap(a, b, axis as 0 | 1 | 2);
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}

/** Local bounds posed into the same space as `position` and `rotation`. */
export function posedAabb(bounds: Aabb, position: Vec3, rotation: Vec3): Aabb {
  return enclose(corners(bounds).map((point) => applyPose(point, position, rotation)));
}

function roundCornerCoord(value: number): number {
  const rounded = Number((Math.round(value * 10000) / 10000).toFixed(4));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Component-local corner nearest the origin on every axis: minimum X, the bottom
 * (minimum Y), and minimum Z. The placement pivot can sit on the top after rotation.
 * Coordinates are rounded to 0.0001" so a 90° rotation does not report −0.
 */
export function originCorner(bounds: Aabb, position: Vec3, rotation: Vec3): Vec3 {
  const min = posedAabb(bounds, position, rotation).min;
  return [roundCornerCoord(min[0]), roundCornerCoord(min[1]), roundCornerCoord(min[2])];
}

/** Pivot that puts the origin corner's `axis` at `inches`, keeping rotation and the other axes. */
export function positionForOriginCorner(
  bounds: Aabb,
  position: Vec3,
  rotation: Vec3,
  axis: 0 | 1 | 2,
  inches: number,
): Vec3 {
  const corner = originCorner(bounds, position, rotation);
  const next: Vec3 = [position[0], position[1], position[2]];
  next[axis] += inches - corner[axis];
  return next;
}

/** Smallest box containing every input. `null` when there are none. */
export function unionAabb(boxes: readonly Aabb[]): Aabb | null {
  if (boxes.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max };
}

/** World-space box expressed in a component frame. */
export function aabbInFrame(box: Aabb, framePosition: Vec3, frameRotation: Vec3): Aabb {
  return enclose(corners(box).map((point) => unapplyPose(point, framePosition, frameRotation)));
}

export function nearInstanceKeys(
  selectedKey: string,
  instances: Array<{ key: string; worldBounds: Aabb }>,
  reach = NEAR_REACH,
): string[] {
  const selected = instances.find((instance) => instance.key === selectedKey);
  if (!selected) return [];
  return instances
    .filter(
      (instance) => instance.key !== selectedKey && aabbDistance(selected.worldBounds, instance.worldBounds) <= reach,
    )
    .map((instance) => instance.key);
}

function overlaps(a: Aabb, b: Aabb, axis: 0 | 1 | 2): boolean {
  return a.max[axis] >= b.min[axis] - DISTINCT_EPS && b.max[axis] >= a.min[axis] - DISTINCT_EPS;
}

/**
 * Shift along `axis` that lands `moving` on exactly one nearby boundary.
 * `0` counts toward ambiguity (a flush face) but is not returned.
 * `null` when there is no shift, or more than one distinct shift within reach.
 */
export function boundarySnapDelta(
  moving: Aabb,
  others: Aabb[],
  axis: 0 | 1 | 2,
  reach = NEAR_REACH,
): number | null {
  const deltas: number[] = [];
  const faces = [moving.min[axis], moving.max[axis]];
  for (const other of others) {
    const beside = ([0, 1, 2] as const).every((index) => index === axis || overlaps(moving, other, index));
    if (!beside) continue;
    for (const face of faces) {
      for (const target of [other.min[axis], other.max[axis]]) {
        const delta = target - face;
        if (Math.abs(delta) <= reach) deltas.push(delta);
      }
    }
  }
  const distinct: number[] = [];
  for (const delta of deltas) {
    if (!distinct.some((existing) => Math.abs(existing - delta) < DISTINCT_EPS)) distinct.push(delta);
  }
  if (distinct.length !== 1) return null;
  const only = distinct[0];
  if (Math.abs(only) < DISTINCT_EPS) return null;
  return only;
}
