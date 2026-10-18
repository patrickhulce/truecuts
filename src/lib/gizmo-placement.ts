import { Matrix4, Vector3, type Camera } from "three";
import type { Aabb, Vec3 } from "./geometry";

/** Vote on a screen-safe anchor, then convert it back to the item's local frame. */
export function chooseGizmoPlacement(
  bounds: Aabb, world: Matrix4, camera: Camera,
  width: number, height: number, previous?: Vec3,
): Vec3 | null {
  if (width <= 0 || height <= 0) return null;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  // Reserve room for the 100px handles, toolbar, and bottom viewport controls.
  const mx = Math.min(116, width * 0.35), my = Math.min(140, height * 0.35);
  const safe = { left: mx, right: width - mx, top: my, bottom: height - my };
  const project = (p: Vec3) => {
    const point = new Vector3(...p).applyMatrix4(world);
    const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
    const ndc = point.project(camera);
    if (view.z >= 0 || ndc.z < -1 || ndc.z > 1) return null;
    return { x: (ndc.x + 1) * width / 2, y: (1 - ndc.y) * height / 2, z: ndc.z };
  };
  const samples = [];
  for (const x of [0, 0.5, 1]) for (const y of [0, 0.5, 1]) for (const z of [0, 0.5, 1]) {
    const p = [x, y, z].map((t, axis) => bounds.min[axis] + t * (bounds.max[axis] - bounds.min[axis])) as Vec3;
    const screen = project(p);
    if (screen) samples.push(screen);
  }
  if (!samples.length) return null;
  const box = {
    left: Math.min(...samples.map(p => p.x)), right: Math.max(...samples.map(p => p.x)),
    top: Math.min(...samples.map(p => p.y)), bottom: Math.max(...samples.map(p => p.y)),
  };
  const cx = (clamp(box.left, safe.left, safe.right) + clamp(box.right, safe.left, safe.right)) / 2;
  const cy = (clamp(box.top, safe.top, safe.bottom) + clamp(box.bottom, safe.top, safe.bottom)) / 2;
  const depth = samples.reduce((sum, p) => sum + p.z, 0) / samples.length;
  const old = previous ? project(previous) : null;
  const candidates = [...samples];
  // Include positions beside the visible selection, and a center fallback when zoomed inside it.
  for (const x of [box.left - 28, cx, box.right + 28]) {
    for (const y of [box.top - 28, cy, box.bottom + 28]) candidates.push({ x, y, z: depth });
  }
  if (old) candidates.push(old);
  const span = Math.max(100, Math.hypot(safe.right - safe.left, safe.bottom - safe.top));
  const score = (p: { x: number; y: number }) => {
    const proximity = 1 - Math.min(1, Math.hypot(p.x - cx, p.y - cy) / span);
    const outside = p.x < box.left || p.x > box.right || p.y < box.top || p.y > box.bottom;
    const clearance = outside ? 1 : 0;
    const stability = old ? 1 - Math.min(1, Math.hypot(p.x - old.x, p.y - old.y) / 160) : 0;
    return 0.5 * proximity + 0.3 * clearance + 0.2 * stability;
  };
  const ranked = candidates.map(p => ({ ...p, x: clamp(p.x, safe.left, safe.right), y: clamp(p.y, safe.top, safe.bottom) }));
  let best = ranked.reduce((a, b) => score(b) > score(a) ? b : a);
  if (old && old.x >= safe.left && old.x <= safe.right && old.y >= safe.top && old.y <= safe.bottom && score(old) + 0.04 >= score(best)) best = old;
  const local = new Vector3(2 * best.x / width - 1, 1 - 2 * best.y / height, best.z)
    .unproject(camera).applyMatrix4(world.clone().invert());
  return local.toArray() as Vec3;
}
