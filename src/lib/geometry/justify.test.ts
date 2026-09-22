import { describe, expect, it } from "vitest";
import { gapCount, layoutClosed, layoutOpen } from "./justify";

describe("gapCount", () => {
  it("uses one gap for a zero-length run", () => {
    expect(gapCount(0, 4)).toBe(1);
  });

  it("rounds up so every gap is at most the separation", () => {
    expect(gapCount(10, 4)).toBe(3);
    expect(gapCount(8, 4)).toBe(2);
  });
});

describe("layoutOpen", () => {
  it("pins space-between fasteners to both ends", () => {
    const points = layoutOpen(10, 4, "space-between");
    expect(points).toHaveLength(4);
    expect(points[0]).toBeCloseTo(0);
    expect(points[points.length - 1]).toBeCloseTo(10);
    for (let index = 1; index < points.length; index++) {
      expect(points[index] - points[index - 1]).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it("leaves a half-gap at each end for space-around", () => {
    const points = layoutOpen(10, 4, "space-around");
    expect(points).toHaveLength(3);
    expect(points[0]).toBeCloseTo(10 / 6);
    expect(points[1]).toBeCloseTo(5);
    expect(points[2]).toBeCloseTo(10 - 10 / 6);
    expect(points[1] - points[0]).toBeLessThanOrEqual(4 + 1e-9);
  });
});

describe("layoutClosed", () => {
  it("starts space-between on the path origin and offsets space-around by half a gap", () => {
    const between = layoutClosed(23, 6, "space-between");
    const around = layoutClosed(23, 6, "space-around");
    expect(between).toHaveLength(4);
    expect(around).toHaveLength(4);
    expect(between[0]).toBeCloseTo(0);
    expect(around[0]).toBeCloseTo(23 / 8);
  });
});
