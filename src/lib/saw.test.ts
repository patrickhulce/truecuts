import { describe, expect, it } from "vitest";
import { applySawOutline, insideSawOutline, sawArea, sawPrism, sawSurface, snapSawPoint, splitSawOutline, validateSawOutline, type SawPoint } from "./saw";
import { applyCuts } from "./geometry/cuts";
import { polyhedronVolume } from "./geometry/solids";
import { compileDocument } from "./compile";
import { setMemberOutline } from "./edit";

const square: SawPoint[] = [[0, 0], [24, 0], [24, 24], [0, 24]];
const lShape: SawPoint[] = [[0, 0], [24, 0], [24, 12], [12, 12], [12, 24], [0, 24]];

describe("saw paths", () => {
  it("removes a corner along a bent cut, leaving an L", () => {
    const pieces = splitSawOutline(square, [[24, 12], [12, 12], [12, 24]]);
    expect(pieces.map(sawArea).sort((a, b) => a - b)).toEqual([144, 432]);
    const kept = pieces.find(piece => insideSawOutline([1, 1], piece))!;
    expect(insideSawOutline([20, 20], kept)).toBe(false);
    expect(polyhedronVolume(sawPrism(kept, 0.5))).toBeCloseTo(216);
    expect(sawArea(sawSurface(sawPrism(kept, 0.5)).outline)).toBeCloseTo(432);
  });
  it("cuts a diagonal triangle", () => {
    const pieces = splitSawOutline(square, [[0, 0], [24, 24]]);
    expect(pieces.map(sawArea)).toEqual([288, 288]);
  });
  it("cuts four corners to make an octagon", () => {
    let outline = square;
    for (const path of [ [[0, 4], [4, 0]], [[20, 0], [24, 4]], [[24, 20], [20, 24]], [[4, 24], [0, 20]] ] as SawPoint[][]) {
      outline = splitSawOutline(outline, path).find(piece => insideSawOutline([12, 12], piece))!;
    }
    expect(outline).toHaveLength(8);
    expect(sawArea(outline)).toBeCloseTo(544);
    expect(polyhedronVolume(sawPrism(outline, 0.5))).toBeCloseTo(272);
  });
  it("rejects interior endpoints, self crossings, and paths outside material", () => {
    expect(() => splitSawOutline(square, [[12, 12], [24, 12]])).toThrow(/edge/);
    expect(() => splitSawOutline(square, [[0, 12], [30, 12], [24, 24]])).toThrow();
    expect(() => splitSawOutline(square, [[0, 4], [20, 20], [4, 20], [20, 4], [24, 4]])).toThrow();
    expect(() => validateSawOutline([[0, 0], [24, 24], [0, 24], [24, 0]], [24, 24, 1])).toThrow();
  });
  it("snaps to corners, midpoints, boundaries, and 45 degree directions", () => {
    expect(snapSawPoint([0.1, 0.2], undefined, square, 0.5, 1)).toEqual([0, 0]);
    expect(snapSawPoint([12.1, 0.1], undefined, square, 0.5, 1)).toEqual([12, 0]);
    expect(snapSawPoint([17.2, 0.1], undefined, square, 0.5, 1)).toEqual([17, 0]);
    expect(snapSawPoint([11.8, 13.1], [0, 0], square, 0.5, 0)).toEqual([12.5, 12.5]);
    expect(snapSawPoint([23.7, 23.5], [0, 0], square, 0.5, 1)).toEqual([24, 24]);
    // Nearby off-angle landmarks cannot pull the line away from 45 degrees.
    const p = snapSawPoint([11.8, 13.1], [0, 0], [[12, 13], ...square], 0.5, 2);
    expect(p[0]).toBe(p[1]);
  });
});

describe("saw solids", () => {
  it("keeps concave cut caps watertight when trimmed on any axis", () => {
    for (const [axis, at, volume] of [[0, 18, 360], [1, 18, 360], [2, 0.5, 216]] as const) {
      const solid = applySawOutline([24, 24, 1], lShape, [{axis, at, angle: 90, side: "end"}]);
      expect(polyhedronVolume(solid)).toBeCloseTo(volume);
      // Every edge has an oppositely oriented partner, including cap triangulation seams.
      const directed = new Map<string, number>();
      const key = (point: number[]) => point.map(n => n.toFixed(5)).join(",");
      for (const face of solid) for (let i = 0; i < face.length; i++) {
        const a = key(face[i]), b = key(face[(i + 1) % face.length]);
        if (a === b) continue;
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        directed.set(edge, (directed.get(edge) ?? 0) + (a < b ? 1 : -1));
      }
      expect([...directed.values()].every(n => n === 0)).toBe(true);
      expect(sawArea(sawSurface(solid).outline)).toBeCloseTo(volume / (axis === 2 ? 0.5 : 1));
    }
  });
  it("traces existing square and miter cuts but rejects thickness bevels", () => {
    const squareCut = applyCuts([24, 24, 1], [{ axis: 0, at: 12, angle: 90, side: "end" }]);
    expect(sawArea(sawSurface(squareCut).outline)).toBeCloseTo(288);
    const miter = applyCuts([24, 24, 1], [{ axis: 0, at: [0, 24], angle: 45, side: "end" }]);
    expect(sawArea(sawSurface(miter).outline)).toBeCloseTo(288);
    const bevel = applyCuts([24, 24, 1], [{ axis: 0, at: [12, 24], around: 1, angle: 45, side: "end" }]);
    expect(() => sawSurface(bevel)).toThrow(/bevel/);
  });
  it("round trips an L through YAML and scene geometry", () => {
    const source = `version: 2\nname: Saw test\nmembers:\n  - id: panel-1\n    label: Panel\n    stock: plywood-1/2-4x8\ncomponents:\n  - id: build-1\n    label: Build\n    members:\n      - id: panel-1\n`;
    const result = compileDocument(setMemberOutline(source, "panel-1", lShape));
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.members[0].outline).toEqual(lShape);
    expect(result.scene).toBeDefined();
  });
});
