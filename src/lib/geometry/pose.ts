import type { Vec3 } from "./types";
import { add, degToRad, sub } from "./vec3";

/**
 * Rotate `v` by Euler XYZ in degrees (same convention as THREE.Euler default).
 * THREE applies Rz then Ry then Rx (matrix Rx Ry Rz on column vectors).
 */
export function rotateEulerXYZ(v: Vec3, rotationDeg: Vec3): Vec3 {
  const rx = degToRad(rotationDeg[0]);
  const ry = degToRad(rotationDeg[1]);
  const rz = degToRad(rotationDeg[2]);
  let x = v[0];
  let y = v[1];
  let z = v[2];

  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x1 = x * cz - y * sz;
  const y1 = x * sz + y * cz;
  x = x1;
  y = y1;

  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const x2 = x * cy + z * sy;
  const z2 = -x * sy + z * cy;
  x = x2;
  z = z2;

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const y3 = y * cx - z * sx;
  const z3 = y * sx + z * cx;
  return [x, y3, z3];
}

export function applyPose(point: Vec3, position: Vec3, rotationDeg: Vec3): Vec3 {
  return add(rotateEulerXYZ(point, rotationDeg), position);
}

/** Inverse of `rotateEulerXYZ` (undo Rx, then Ry, then Rz). */
export function inverseRotateEulerXYZ(v: Vec3, rotationDeg: Vec3): Vec3 {
  const rx = degToRad(rotationDeg[0]);
  const ry = degToRad(rotationDeg[1]);
  const rz = degToRad(rotationDeg[2]);
  let x = v[0];
  let y = v[1];
  let z = v[2];

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const y1 = y * cx + z * sx;
  const z1 = -y * sx + z * cx;
  y = y1;
  z = z1;

  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const x2 = x * cy - z * sy;
  const z2 = x * sy + z * cy;
  x = x2;
  z = z2;

  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x3 = x * cz + y * sz;
  const y3 = -x * sz + y * cz;
  return [x3, y3, z];
}

/** Inverse of `applyPose`. */
export function unapplyPose(point: Vec3, position: Vec3, rotationDeg: Vec3): Vec3 {
  return inverseRotateEulerXYZ(sub(point, position), rotationDeg);
}

/** Component-local translation that moves a placement by `distance` along world +X. */
export function localShiftForWorldX(componentRotation: Vec3, distance: number): Vec3 {
  return inverseRotateEulerXYZ([distance, 0, 0], componentRotation);
}
