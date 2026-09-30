import { describe, expect, it } from "vitest";
import { frameCamera } from "./camera-frame";
import type { Aabb } from "./geometry";

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Aabb {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

const HALF_FOV = (17.5 * Math.PI) / 180;

describe("frameCamera", () => {
  it("centers the box", () => {
    expect(frameCamera(box(0, 2, 4, 10, 8, 6), 35, 1).center).toEqual([5, 5, 5]);
  });

  it("fits a bounding sphere inside the field of view", () => {
    const frame = frameCamera(box(0, 0, 0, 10, 0, 0), 35, 1);
    expect(frame.distance).toBeCloseTo((5 * 1.25) / Math.sin(HALF_FOV), 5);
    expect(frame.near).toBe(0.1);
    expect(frame.far).toBe(4000);
  });

  it("uses a minimum radius for a degenerate box", () => {
    const frame = frameCamera(box(1, 2, 3, 1, 2, 3), 35, 1);
    expect(frame.center).toEqual([1, 2, 3]);
    expect(frame.distance).toBeCloseTo(1.25 / Math.sin(HALF_FOV), 5);
  });

  it("pulls back when the viewport is taller than it is wide", () => {
    const bounds = box(0, 0, 0, 48, 36, 24);
    const wide = frameCamera(bounds, 35, 2);
    const square = frameCamera(bounds, 35, 1);
    const tall = frameCamera(bounds, 35, 0.5);
    expect(wide.distance).toBeCloseTo(square.distance, 5);
    expect(tall.distance).toBeGreaterThan(square.distance);
  });

  it("treats a missing aspect as square", () => {
    const bounds = box(0, 0, 0, 10, 10, 10);
    expect(frameCamera(bounds, 35, 0).distance).toBeCloseTo(frameCamera(bounds, 35, 1).distance, 5);
  });

  it("grows the clip planes for a large build", () => {
    const frame = frameCamera(box(0, 0, 0, 10000, 10000, 10000), 35, 1);
    expect(frame.far).toBeGreaterThan(4000);
    expect(frame.far).toBeCloseTo(frame.distance * 4, 5);
    expect(frame.near).toBeGreaterThan(0.1);
    expect(frame.near).toBeCloseTo(frame.distance / 500, 5);
  });
});
