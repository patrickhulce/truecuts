import { describe, expect, it } from "vitest";
import { convexArea, intersectConvex } from "./polygon";
import type { Face } from "./types";

const NZ: [number, number, number] = [0, 0, 1];

function xy(points: Array<[number, number]>): Face {
  return points.map(([x, y]) => [x, y, 0]);
}

describe("intersectConvex", () => {
  it("returns the overlap of two unit squares", () => {
    const a = xy([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const b = xy([
      [0.5, 0],
      [1.5, 0],
      [1.5, 1],
      [0.5, 1],
    ]);
    const hit = intersectConvex(a, b, NZ);
    expect(hit).not.toBeNull();
    expect(convexArea(hit!, NZ)).toBeCloseTo(0.5, 6);
  });

  it("returns null when disjoint", () => {
    const a = xy([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const b = xy([
      [2, 0],
      [3, 0],
      [3, 1],
      [2, 1],
    ]);
    expect(intersectConvex(a, b, NZ)).toBeNull();
  });

  it("returns the full polygon when they are identical", () => {
    const a = xy([
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ]);
    const hit = intersectConvex(a, a, NZ);
    expect(convexArea(hit!, NZ)).toBeCloseTo(2, 6);
  });

  it("clips a triangle against a quad", () => {
    const triangle = xy([
      [0, 0],
      [2, 0],
      [0, 2],
    ]);
    const quad = xy([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const hit = intersectConvex(triangle, quad, NZ);
    expect(convexArea(hit!, NZ)).toBeCloseTo(1, 5);
  });

  it("clips a mitered trapezoid against a rectangle", () => {
    const trap = xy([
      [0, 0],
      [6, 0],
      [10, 4],
      [0, 4],
    ]);
    const rect = xy([
      [5, 0],
      [12, 0],
      [12, 4],
      [5, 4],
    ]);
    const hit = intersectConvex(trap, rect, NZ);
    expect(hit).not.toBeNull();
    expect(convexArea(hit!, NZ)).toBeGreaterThan(10);
    expect(convexArea(hit!, NZ)).toBeLessThan(convexArea(trap, NZ));
  });
});
