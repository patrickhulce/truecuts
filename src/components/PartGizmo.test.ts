import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { PivotControls } from "@react-three/drei";
import { PartGizmo } from "./PartGizmo";
import type { Vec3 } from "@/lib/geometry";

vi.mock("@react-three/fiber", () => ({ useFrame: vi.fn() }));

const captured = vi.hoisted(() => ({ props: null as ComponentProps<typeof PivotControls> | null, diagonals: [] as ComponentProps<typeof PivotControls>[] }));
vi.mock("@react-three/drei", () => ({
  PivotControls: (props: ComponentProps<typeof PivotControls>) => {
    captured.props = props;
    if (props.scale === 76) captured.diagonals.push(props);
    return null;
  },
}));

describe("PartGizmo", () => {
  it("keeps smaller diagonal arrows at 45 degrees after a compound item rotation", () => {
    captured.diagonals = [];
    const rotation: Vec3 = [20, -35, 45];
    const position: Vec3 = [10, 20, 30];
    const onDraft = vi.fn();
    renderToString(createElement(PartGizmo, {
      pose: { position, rotation }, bounds: { min: [0, 0, 0], max: [24, 1.5, 3.5] },
      onDragStart: vi.fn(), onDraft, onCommit: vi.fn(),
    }));
    expect(captured.diagonals).toHaveLength(3);
    const directions: Vec3[] = [[1, 1, 0], [1, 0, 1], [0, 1, 1]];
    captured.diagonals.forEach((props, index) => {
      expect(props.opacity).toBeLessThan(1);
      expect(props.scale).toBeLessThan(captured.props!.scale as number);
      const orientation = props.matrix!.clone().multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...props.rotation as Vec3)));
      const arrow = new THREE.Vector3(1, 0, 0).transformDirection(orientation);
      const expected = new THREE.Vector3(...directions[index]).normalize();
      expect(arrow.distanceTo(expected)).toBeLessThan(1e-6);
      props.onDragStart!({ component: "Arrow", axis: 0, origin: new THREE.Vector3(), directions: [arrow] });
      const delta = new THREE.Matrix4().makeTranslation(...directions[index].map(n => n * 3.3) as Vec3);
      const moved = delta.clone().multiply(props.matrix!);
      props.onDrag!(moved, delta, moved, delta);
      expect(onDraft).toHaveBeenLastCalledWith(position.map((n, axis) => n + directions[index][axis] * 3), rotation);
      props.onDragEnd!();
    });
  });
  it.each<Vec3>([[0, 45, 0], [0, 0, 90], [20, -35, 45]])(
    "keeps translation axes aligned with the editing frame for rotation %j",
    (...rotation) => {
      const onDraft = vi.fn();
      const onCommit = vi.fn();
      const position: Vec3 = [10, 20, 30];
      renderToString(createElement(PartGizmo, {
        pose: { position, rotation },
        bounds: { min: [0, 0, 0], max: [24, 1.5, 3.5] },
        onDragStart: vi.fn(), onDraft, onCommit,
      }));
      const props = captured.props!;
      const angles = props.rotation as [number, number, number];
      const controls = props.matrix!.clone().multiply(
        new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...angles)),
      );
      for (const axis of [0, 1, 2] as const) {
        const direction = new THREE.Vector3().setComponent(axis, 1).transformDirection(controls);
        for (let index = 0; index < 3; index++) {
          expect(direction.getComponent(index)).toBeCloseTo(index === axis ? 1 : 0);
        }
        props.onDragStart!({ component: "Arrow", axis, origin: new THREE.Vector3(), directions: [direction] });
        const delta = new THREE.Matrix4().makeTranslation(...direction.multiplyScalar(4).toArray() as Vec3);
        const dragged = delta.clone().multiply(props.matrix!);
        props.onDrag!(dragged, delta, dragged, delta);
        const expected = [...position];
        expected[axis] += 4;
        expect(onDraft).toHaveBeenLastCalledWith(expected, rotation);
        props.onDragEnd!();
        expect(onCommit).toHaveBeenLastCalledWith(expected, rotation);
      }
      // The item matrix itself remains rotated, for local bounds and pose updates.
      const expectedRotation = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as Vec3),
      );
      expect(new THREE.Matrix4().extractRotation(props.matrix!).elements).toEqual(expectedRotation.elements);
    },
  );
});
