import { describe, expect, it } from "vitest";
import type { Vec3 } from "./geometry";
import {
  closestAxisPoint,
  measureAlongAxes,
  projectRayToLine,
  snapCoordinateToEdges,
  type MeasureEdge,
} from "./measure";

describe("projectRayToLine", () => {
  it("returns the line coordinate closest to the ray", () => {
    expect(projectRayToLine([10, 5, 0], [0, -1, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(10);
    expect(projectRayToLine([0, 5, 0], [1, -1, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(5);
    expect(projectRayToLine([0, 5, 5], [0, -1, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it("projects the ray origin onto the line when the two are parallel", () => {
    expect(projectRayToLine([4, 3, 0], [1, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(4);
  });
});

describe("closestAxisPoint", () => {
  it("picks the world axis the ray actually meets", () => {
    const hit = closestAxisPoint([0, 0, 0], [5, 4, 0], [0, -1, 0]);
    expect(hit?.axis).toBe(0);
    expect(hit?.coordinate).toBeCloseTo(5);
    expect(hit?.gap).toBeCloseTo(0);
  });

  it("measures backward along an axis", () => {
    const hit = closestAxisPoint([0, 0, 0], [-4, 3, 0], [0, -1, 0]);
    expect(hit?.axis).toBe(0);
    expect(hit?.coordinate).toBeCloseTo(-4);
  });
});

describe("snapCoordinateToEdges", () => {
  const start: Vec3 = [0, 0, 0];
  const edge = (a: Vec3, b: Vec3): MeasureEdge => ({ a, b });

  it("snaps to an edge within 2 inches and ignores one farther away", () => {
    const near = edge([12, 0, 0], [12, 4, 0]);
    const far = edge([13, 0, 0], [13, 4, 0]);
    expect(snapCoordinateToEdges(start, 0, 10, [near])).toEqual({ coordinate: 12, snapped: true });
    expect(snapCoordinateToEdges(start, 0, 10, [far])).toEqual({ coordinate: 10, snapped: false });
  });

  it("does not collapse onto the edges that leave the start corner", () => {
    const leaving = edge([0, 0, 0], [0, 10, 0]);
    expect(snapCoordinateToEdges(start, 0, 1, [leaving])).toEqual({ coordinate: 1, snapped: false });
  });

  it("ignores an edge more than 2 inches off the tape line", () => {
    const aside = edge([10, 5, 0], [10, 8, 0]);
    expect(snapCoordinateToEdges(start, 0, 10, [aside])).toEqual({ coordinate: 10, snapped: false });
  });
});

describe("measureAlongAxes", () => {
  it("runs the ray onto an axis and seats the end on a nearby edge", () => {
    const reading = measureAlongAxes([0, 0, 0], [10, 4, 0], [0, -1, 0], [{ a: [12, 0, 0], b: [12, 3, 0] }]);
    expect(reading?.axis).toBe(0);
    expect(reading?.end).toEqual([12, 0, 0]);
    expect(reading?.distance).toBeCloseTo(12);
    expect(reading?.snapped).toBe(true);
  });
});
