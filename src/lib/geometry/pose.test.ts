import { describe, expect, it } from "vitest";
import { add } from "./vec3";
import { applyPose, localShiftForWorldX, rotateEulerXYZ, translateByWorldDelta, unapplyPose } from "./pose";
import type { Vec3 } from "./types";

describe("rotateEulerXYZ", () => {
  it("applies intrinsic XYZ rotations", () => {
    const p = rotateEulerXYZ([2, 0, 0], [0, 90, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(-2, 6);
  });
});

describe("localShiftForWorldX", () => {
  it("shifts along local X when the component is unrotated", () => {
    expect(localShiftForWorldX([0, 0, 0], 4.5)).toEqual([4.5, 0, 0]);
  });
});

describe("translateByWorldDelta", () => {
  it("moves the placement origin by the world delta", () => {
    const position: Vec3 = [1, 2, 3];
    const rotation: Vec3 = [10, 25, -15];
    const delta: Vec3 = [4, -2, 1];
    const world = applyPose(position, [0, 0, 0], rotation);
    const expected = unapplyPose(add(world, delta), [0, 0, 0], rotation);
    const next = translateByWorldDelta(position, rotation, delta);
    expect(next[0]).toBeCloseTo(expected[0], 6);
    expect(next[1]).toBeCloseTo(expected[1], 6);
    expect(next[2]).toBeCloseTo(expected[2], 6);
  });
});

describe("unapplyPose", () => {
  it("inverts applyPose", () => {
    const local: Vec3 = [1, 2, 3];
    const position: Vec3 = [4, 5, 6];
    const rotation: Vec3 = [20, -15, 40];
    const back = unapplyPose(applyPose(local, position, rotation), position, rotation);
    expect(back[0]).toBeCloseTo(local[0], 6);
    expect(back[1]).toBeCloseTo(local[1], 6);
    expect(back[2]).toBeCloseTo(local[2], 6);
  });
});
