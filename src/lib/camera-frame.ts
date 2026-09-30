import type { Aabb, Vec3 } from "./geometry";

const PADDING = 1.25;
/** Degenerate builds still frame as a 2″ sphere so the camera stays outside the part. */
const MIN_RADIUS = 1;
const DEFAULT_FAR = 4000;
const NEAR_FLOOR = 0.1;

export type CameraFrame = {
  center: Vec3;
  distance: number;
  near: number;
  far: number;
};

/**
 * Orbit framing for a world-space box. Distance fits the bounding sphere in the
 * tighter of the vertical and horizontal fields of view.
 */
export function frameCamera(box: Aabb, fovDeg: number, aspect: number): CameraFrame {
  const center: Vec3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const size: Vec3 = [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
  const radius = Math.max(0.5 * Math.hypot(size[0], size[1], size[2]), MIN_RADIUS);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * safeAspect);
  const half = Math.min(vHalf, hHalf);
  const sinHalf = Math.sin(half);
  const distance = sinHalf > 1e-6 ? (radius * PADDING) / sinHalf : radius * PADDING;
  return {
    center,
    distance,
    ...clipForDistance(distance),
  };
}

/** Clip planes for a perspective camera sitting `distance` inches from its target. */
export function clipForDistance(distance: number): { near: number; far: number } {
  return {
    near: Math.max(NEAR_FLOOR, distance / 500),
    far: Math.max(DEFAULT_FAR, distance * 4),
  };
}
