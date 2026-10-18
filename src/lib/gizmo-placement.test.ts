import { describe, expect, it } from "vitest";
import { Matrix4, PerspectiveCamera, OrthographicCamera, Vector3 } from "three";
import { chooseGizmoPlacement } from "./gizmo-placement";
import type { Aabb } from "./geometry";

const bounds: Aabb = { min: [0, 0, 0], max: [96, 1.5, 48] };
const world = new Matrix4();
function camera() {
  const c = new PerspectiveCamera(35, 800 / 600, 0.1, 4000);
  c.position.set(120, 100, 140);
  c.lookAt(48, 0, 24);
  c.updateMatrixWorld();
  return c;
}
function screenSafe(c: PerspectiveCamera | OrthographicCamera, transform = world, box = bounds) {
  const anchor = chooseGizmoPlacement(box, transform, c, 800, 600);
  expect(anchor).not.toBeNull();
  const p = new Vector3(...anchor!).applyMatrix4(transform).project(c);
  expect((p.x + 1) * 400).toBeGreaterThanOrEqual(115.99);
  expect((p.x + 1) * 400).toBeLessThanOrEqual(684.01);
  expect((1 - p.y) * 300).toBeGreaterThanOrEqual(139.99);
  expect((1 - p.y) * 300).toBeLessThanOrEqual(460.01);
  return anchor!;
}
describe("gizmo placement voting", () => {
  it("stays visible when a large selection extends beyond the viewport", () => {
    screenSafe(camera(), world, { min: [-1000, -10, -1000], max: [1000, 10, 1000] });
  });
  it("docks a selection outside the view to a reachable screen edge", () => {
    screenSafe(camera(), new Matrix4().makeTranslation(-300, 0, 0));
  });
  it("converts the selected screen anchor back through a rotated parent frame", () => {
    screenSafe(camera(), new Matrix4().makeRotationY(Math.PI / 4).setPosition(-10, 0, 20));
  });
  it("keeps its location on repeated votes and tiny camera changes", () => {
    const c = camera();
    const first = screenSafe(c);
    const again = chooseGizmoPlacement(bounds, world, c, 800, 600, first)!;
    expect(new Vector3(...first).distanceTo(new Vector3(...again))).toBeLessThan(1e-6);
    c.position.x += 0.01;
    c.updateMatrixWorld();
    const next = chooseGizmoPlacement(bounds, world, c, 800, 600, first)!;
    expect(new Vector3(...first).distanceTo(new Vector3(...next))).toBeLessThan(1e-6);
  });
  it("supports orthographic views", () => {
    const c = new OrthographicCamera(-60, 60, 45, -45, 0.1, 1000);
    c.position.set(48, 100, 24); c.lookAt(48, 0, 24); c.updateMatrixWorld();
    screenSafe(c);
  });
  it("hides controls behind the camera instead of projecting a mirrored anchor", () => {
    const c = new PerspectiveCamera(35, 800 / 600, 0.1, 1000);
    c.updateMatrixWorld();
    expect(chooseGizmoPlacement(bounds, new Matrix4().makeTranslation(0, 0, 100), c, 800, 600)).toBeNull();
  });
});
