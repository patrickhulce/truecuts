import type { Aabb, Vec3 } from "./geometry";

export type ScreenPoint = { x: number; y: number };

export type ScreenRect = { x0: number; y0: number; x1: number; y1: number };

/** Eight corners of a box, translated by an explode offset. */
export function aabbCorners(box: Aabb, offset: Vec3): Vec3[] {
  const points: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        points.push([x + offset[0], y + offset[1], z + offset[2]]);
      }
    }
  }
  return points;
}

/**
 * True when the projected box overlaps the drag rectangle.
 * `project` returns null for a corner behind the camera, and that corner is dropped.
 */
export function projectedBoxHitsRect(
  corners: readonly Vec3[],
  project: (point: Vec3) => ScreenPoint | null,
  rect: ScreenRect,
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let visible = false;
  for (const corner of corners) {
    const projected = project(corner);
    if (!projected) continue;
    visible = true;
    minX = Math.min(minX, projected.x);
    minY = Math.min(minY, projected.y);
    maxX = Math.max(maxX, projected.x);
    maxY = Math.max(maxY, projected.y);
  }
  if (!visible) return false;
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  return maxX >= left && minX <= right && maxY >= top && minY <= bottom;
}
