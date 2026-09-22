import { describe, expect, it } from "vitest";
import { applyPose, rotateEulerXYZ, unapplyPose } from "./pose";
import type { Vec3 } from "./types";

describe("rotateEulerXYZ", () => {
  it("applies intrinsic XYZ rotations", () => {
    const p = rotateEulerXYZ([2, 0, 0], [0, 90, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(-2, 6);
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
