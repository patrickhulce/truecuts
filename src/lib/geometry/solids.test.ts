import { describe, expect, it } from "vitest";
import {
  boundingBox,
  boxPolyhedron,
  faceNormal,
  flatLBracketPolyhedron,
  lBracketPolyhedron,
  polyhedronVolume,
  rodPolyhedron,
  joistHangerPolyhedron,
  saddlePolyhedron,
  tConnectorPolyhedron,
  uBarPolyhedron,
} from "./solids";

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

describe("tConnectorPolyhedron", () => {
  it("grows the plates without changing gauge or stem height", () => {
    const small = tConnectorPolyhedron([3.5, 3.5, 0.25], 3);
    const wide = tConnectorPolyhedron([12, 7.5, 0.25], 3);
    const smallBox = boundingBox(small);
    const wideBox = boundingBox(wide);
    expect(smallBox.min).toEqual([0, 0, 0]);
    expect(smallBox.max[1]).toBeCloseTo(3, 6);
    expect(wideBox.max[1]).toBeCloseTo(3, 6);
    expect(wideBox.max[0]).toBeCloseTo(12, 6);
    expect(wideBox.max[2]).toBeCloseTo(7.5, 6);
    expect(polyhedronVolume(wide)).toBeCloseTo(12 * 0.25 * (7.5 + 3), 4);
    expect(polyhedronVolume(wide)).toBeCloseTo(polyhedronVolume(tConnectorPolyhedron([6, 7.5, 0.25], 3)) * 2, 4);

    const thicker = boundingBox(tConnectorPolyhedron([12, 7.5, 0.5], 3));
    expect(thicker.max[1]).toBeCloseTo(wideBox.max[1], 6);
    expect(thicker.max[0]).toBeCloseTo(wideBox.max[0], 6);
    expect(thicker.max[2]).toBeCloseTo(wideBox.max[2], 6);
  });
});

describe("saddlePolyhedron", () => {
  it("grows the opening without changing gauge or flange height", () => {
    const narrow = saddlePolyhedron([4, 3.5, 0.25], 2);
    const wide = saddlePolyhedron([4, 9.5, 0.25], 2);
    const narrowBox = boundingBox(narrow);
    const wideBox = boundingBox(wide);
    expect(narrowBox.min).toEqual([0, 0, 0]);
    expect(narrowBox.max[1]).toBeCloseTo(2, 6);
    expect(wideBox.max[1]).toBeCloseTo(2, 6);
    expect(wideBox.max[0]).toBeCloseTo(narrowBox.max[0], 6);
    expect(wideBox.max[2] - narrowBox.max[2]).toBeCloseTo(6, 6);
    expect(wideBox.max[2]).toBeCloseTo(9.5 + 2 * 0.25, 6);
    expect(polyhedronVolume(wide)).toBeCloseTo(4 * 0.25 * (9.5 + 2 * 0.25 + 2 * 2), 4);

    const longer = boundingBox(saddlePolyhedron([10, 3.5, 0.25], 2));
    expect(longer.max[1]).toBeCloseTo(narrowBox.max[1], 6);
    expect(longer.max[2]).toBeCloseTo(narrowBox.max[2], 6);
    expect(longer.max[0]).toBeCloseTo(10, 6);

    const thicker = boundingBox(saddlePolyhedron([4, 3.5, 0.5], 2));
    expect(thicker.max[1]).toBeCloseTo(2, 6);
    expect(thicker.max[2]).toBeCloseTo(3.5 + 2 * 0.5, 6);
  });
});

describe("joistHangerPolyhedron", () => {
  it("cups a 2×4 and bends a header flange out from each side", () => {
    const depth = 2;
    const opening = 1.5;
    const gauge = 0.125;
    const height = 3.125;
    const face = 1.5;
    const poly = joistHangerPolyhedron([depth, opening, gauge], height, face);
    const box = boundingBox(poly);
    expect(box.min).toEqual([0, 0, 0]);
    expect(box.max[0]).toBeCloseTo(depth, 6);
    expect(box.max[1]).toBeCloseTo(height, 6);
    expect(box.max[2]).toBeCloseTo(opening + 2 * gauge + 2 * face, 6);
    const seat = depth * (opening + 2 * gauge) * gauge;
    const walls = 2 * depth * gauge * height;
    const flanges = 2 * gauge * face * height;
    expect(polyhedronVolume(poly)).toBeCloseTo(seat + walls + flanges, 4);
  });
});

describe("rodPolyhedron", () => {
  it("inscribes a 12″ × 1″ rod in its bounding box", () => {
    const poly = rodPolyhedron([12, 1, 1]);
    const { min, max } = boundingBox(poly);
    expect(min[0]).toBeCloseTo(0, 6);
    expect(min[1]).toBeCloseTo(0, 6);
    expect(min[2]).toBeCloseTo(0, 6);
    expect(max[0]).toBeCloseTo(12, 6);
    expect(max[1]).toBeCloseTo(1, 6);
    expect(max[2]).toBeCloseTo(1, 6);
    const prism = 12 * 8 * 0.25 * Math.sin((2 * Math.PI) / 16);
    const cylinder = 12 * Math.PI * 0.25;
    expect(polyhedronVolume(poly)).toBeCloseTo(prism, 4);
    expect(polyhedronVolume(poly)).toBeLessThan(cylinder);
    expect(polyhedronVolume(poly)).toBeLessThan(12);
  });
});

describe("uBarPolyhedron", () => {
  it("spans the length and stands the ends up to the drop", () => {
    const length = 18;
    const drop = 5;
    const flange = 2;
    const poly = uBarPolyhedron([length, 0.75, 0.75], drop, flange);
    const box = boundingBox(poly);
    expect(box.min[0]).toBeCloseTo(0, 5);
    expect(box.min[1]).toBeCloseTo(0, 5);
    expect(box.min[2]).toBeCloseTo(0, 5);
    expect(box.max[0]).toBeCloseTo(length, 5);
    expect(box.max[1]).toBeCloseTo(drop, 5);
    expect(box.max[2]).toBeCloseTo(flange, 5);
    expect(polyhedronVolume(poly)).toBeGreaterThan(0);
    const bottom = poly
      .map((face) => ({
        face,
        y: face.reduce((sum, point) => sum + point[1], 0) / face.length,
      }))
      .sort((a, b) => a.y - b.y)[0];
    expect(bottom).toBeDefined();
    expect(faceNormal(bottom!.face)[1]).toBeLessThan(0);
  });

  it("lengthens the bar without raising the ends or widening the plates", () => {
    const short = boundingBox(uBarPolyhedron([24, 0.75, 0.75], 5, 2));
    const long = boundingBox(uBarPolyhedron([72, 0.75, 0.75], 5, 2));
    expect(long.max[0] - long.min[0]).toBeCloseTo(72, 5);
    expect(long.max[1]).toBeCloseTo(short.max[1], 5);
    expect(long.max[2]).toBeCloseTo(short.max[2], 5);
    expect(polyhedronVolume(uBarPolyhedron([72, 0.75, 0.75], 5, 2))).toBeGreaterThan(
      polyhedronVolume(uBarPolyhedron([24, 0.75, 0.75], 5, 2)),
    );
  });
});
