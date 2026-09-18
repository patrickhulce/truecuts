import { describe, expect, it } from "vitest";
import {
  applyCuts,
  boundingBox,
  boxPolyhedron,
  lBracketPolyhedron,
  polyhedronVolume,
  rotateEulerXYZ,
} from "./geometry";
import type { ResolvedCut } from "./schema";

const BOX: [number, number, number] = [10, 4, 2];

describe("boxPolyhedron", () => {
  it("has the volume of the AABB", () => {
    expect(polyhedronVolume(boxPolyhedron(BOX))).toBeCloseTo(80, 6);
  });
});

describe("applyCuts", () => {
  it("square-cuts the length and keeps the origin side", () => {
    const cuts: ResolvedCut[] = [{ axis: 0, angle: 90, at: 5, side: "end" }];
    const poly = applyCuts(BOX, cuts);
    expect(polyhedronVolume(poly)).toBeCloseTo(40, 6);
    const { min, max } = boundingBox(poly);
    expect(min[0]).toBeCloseTo(0, 6);
    expect(max[0]).toBeCloseTo(5, 6);
    expect(max[1]).toBeCloseTo(4, 6);
    expect(max[2]).toBeCloseTo(2, 6);
  });

  it("square-cuts the start side", () => {
    const cuts: ResolvedCut[] = [{ axis: 0, angle: 90, at: 5, side: "start" }];
    const poly = applyCuts(BOX, cuts);
    expect(polyhedronVolume(poly)).toBeCloseTo(40, 6);
    const { min, max } = boundingBox(poly);
    expect(min[0]).toBeCloseTo(5, 6);
    expect(max[0]).toBeCloseTo(10, 6);
  });

  it("miters with short/long points and reduces volume by the wedge", () => {
    const cuts: ResolvedCut[] = [{ axis: 0, angle: 45, at: [6, 10], side: "end" }];
    const poly = applyCuts(BOX, cuts);
    // Wedge is 0.5 * 4 * 4 * 2 = 16
    expect(polyhedronVolume(poly)).toBeCloseTo(64, 5);
    const verts = poly.flat();
    const has = (x: number, y: number) =>
      verts.some((v) => Math.abs(v[0] - x) < 1e-4 && Math.abs(v[1] - y) < 1e-4);
    expect(has(6, 0)).toBe(true); // short point
    expect(has(10, 4)).toBe(true); // long point
    expect(has(10, 0)).toBe(false); // discarded far corner on the min-width edge
    const { max } = boundingBox(poly);
    expect(max[0]).toBeCloseTo(10, 5);
  });

  it("supports sequential cuts on both ends", () => {
    const cuts: ResolvedCut[] = [
      { axis: 0, angle: 90, at: 8, side: "end" },
      { axis: 0, angle: 90, at: 2, side: "start" },
    ];
    const poly = applyCuts(BOX, cuts);
    expect(polyhedronVolume(poly)).toBeCloseTo(48, 6);
    const { min, max } = boundingBox(poly);
    expect(min[0]).toBeCloseTo(2, 6);
    expect(max[0]).toBeCloseTo(8, 6);
  });
});

describe("rotateEulerXYZ", () => {
  it("applies intrinsic XYZ rotations", () => {
    const p = rotateEulerXYZ([2, 0, 0], [0, 90, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(-2, 6);
  });
});

describe("lBracketPolyhedron", () => {
  it("is two square flanges sharing the fold", () => {
    const poly = lBracketPolyhedron([2, 2, 0.125]);
    const { min, max } = boundingBox(poly);
    expect(min).toEqual([0, 0, 0]);
    expect(max[0]).toBeCloseTo(2, 6);
    expect(max[1]).toBeCloseTo(2, 6);
    expect(max[2]).toBeCloseTo(2, 6);
    expect(polyhedronVolume(poly)).toBeGreaterThan(0.4);
  });
});
