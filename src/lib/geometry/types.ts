import type { Axis } from "../schema";

export type Vec3 = [number, number, number];
export type Face = Vec3[];
export type Polyhedron = Face[];

/**
 * Map a cut/size axis (0=L, 1=W, 2=T) onto a local XYZ coordinate.
 * Default frame: L along +X, W along +Z, T along +Y.
 */
export const AXIS_TO_COORD = [0, 2, 1] as const;

export function axisCoord(axis: Axis): 0 | 1 | 2 {
  return AXIS_TO_COORD[axis];
}

export type Plane = {
  /** Keep the half-space n·x <= d. */
  normal: Vec3;
  d: number;
};
