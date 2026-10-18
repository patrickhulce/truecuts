import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { PivotControls } from "@react-three/drei";
import { PartGizmo } from "./PartGizmo";
import type { Vec3 } from "@/lib/geometry";

const captured = vi.hoisted(() => ({ props: null as ComponentProps<typeof PivotControls> | null }));
vi.mock("@react-three/drei", () => ({
  PivotControls: (props: ComponentProps<typeof PivotControls>) => {
    captured.props = props;
    return null;
  },
}));

describe("PartGizmo", () => {
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
