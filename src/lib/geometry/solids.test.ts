import { describe, expect, it } from "vitest";
import { boundingBox, boxPolyhedron, flatLBracketPolyhedron, lBracketPolyhedron, polyhedronVolume } from "./solids";

const BOX: [number, number, number] = [10, 4, 2];

describe("boxPolyhedron", () => {
  it("has the volume of the AABB", () => {
    expect(polyhedronVolume(boxPolyhedron(BOX))).toBeCloseTo(80, 6);
  });

  it("maps L×W×T onto X/Z/Y", () => {
    const { min, max } = boundingBox(boxPolyhedron(BOX));
    expect(min).toEqual([0, 0, 0]);
    expect(max[0]).toBeCloseTo(10, 6);
    expect(max[1]).toBeCloseTo(2, 6);
    expect(max[2]).toBeCloseTo(4, 6);
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

describe("flatLBracketPolyhedron", () => {
  it("is a single-plane L of two overlapping plates", () => {
    const leg = 2;
    const arm = 1;
    const thickness = 0.125;
    const poly = flatLBracketPolyhedron([leg, arm, thickness]);
    const { min, max } = boundingBox(poly);
    expect(min).toEqual([0, 0, 0]);
    expect(max[0]).toBeCloseTo(leg, 6);
    expect(max[1]).toBeCloseTo(thickness, 6);
    expect(max[2]).toBeCloseTo(leg, 6);
    expect(polyhedronVolume(poly)).toBeCloseTo(thickness * (2 * leg * arm - arm * arm), 6);
  });
});
