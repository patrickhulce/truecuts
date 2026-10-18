import type { Object3D } from "three";
import { snapValue } from "./edit";
import type { Vec3 } from "./geometry";

export const DIAGONAL_DIRECTIONS: Vec3[] = [[1, 1, 0], [1, 0, 1], [0, 1, 1]];
export const GIZMO_HANDLE = { gizmoHandle: true };

/** Match the always-on-top rendering with hit priority, preserving distance order within each layer. */
export function prioritizeGizmoHits<T extends { object: Object3D }>(hits: T[]): T[] {
  const isHandle = (object: Object3D): boolean => {
    for (let node: Object3D | null = object; node; node = node.parent) {
      if (node.userData.gizmoHandle) return true;
    }
    return false;
  };
  return [...hits].sort((a, b) => Number(isHandle(b.object)) - Number(isHandle(a.object)));
}

/** Snap the shared run on both axes, never allowing a diagonal to drift off 45°. */
export function snapDiagonalPosition(start: Vec3, raw: Vec3, direction: Vec3, step: number): Vec3 {
  const lengthSquared = direction.reduce((sum, n) => sum + n * n, 0);
  const run = direction.reduce((sum, n, axis) => sum + (raw[axis] - start[axis]) * n, 0) / lengthSquared;
  const snapped = snapValue(run, step);
  return start.map((value, axis) => value + direction[axis] * snapped) as Vec3;
}
