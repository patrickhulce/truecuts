import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import type { Vec3 } from "./geometry";
import {
  closestAxisPoint,
  dominantWorldAxis,
  extractSceneDimensions,
  measureAlongAxes,
  projectRayToLine,
  snapCoordinateToEdges,
  type MeasureEdge,
} from "./measure";

const SCENE_YAML = `version: 1
name: Measure
members:
  - label: Short
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 8 }
  - label: Long
    stock: 2x4x8
components:
  - label: Build
    position: [10, 0, 0]
    rotation: [0, 90, 0]
    members:
      - { id: short-1, position: [0, 0, 0], rotation: [0, 0, 0] }
      - { id: long-1, position: [0, 0, 12], rotation: [0, 0, 0] }
`;

const STOOD_YAML = `version: 1
name: Stood
members:
  - { label: Post, stock: 2x4x8 }
components:
  - label: Build
    position: [0, 0, 0]
    rotation: [0, 0, 0]
    members:
      - { id: post-1, position: [0, 0, 0], rotation: [0, 0, 90] }
`;

describe("dominantWorldAxis", () => {
  it("picks the largest component and breaks ties toward X then Y", () => {
    expect(dominantWorldAxis([1, 0, 0])).toBe(0);
    expect(dominantWorldAxis([0, -2, 0])).toBe(1);
    expect(dominantWorldAxis([0.2, 0.1, -0.9])).toBe(2);
    expect(dominantWorldAxis([1, 1, 0])).toBe(0);
    expect(dominantWorldAxis([0, 1, -1])).toBe(1);
  });
});

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

describe("extractSceneDimensions", () => {
  it("labels only dimensions longer than a foot, in world space", () => {
    const scene = compileDocument(SCENE_YAML).scene;
    expect(scene).toBeDefined();
    const dimensions = extractSceneDimensions(scene!, new Map());
    expect(dimensions.map((item) => item.memberKey)).toEqual(["build-1/long-1#1"]);
    const length = dimensions[0]!;
    expect(length.axis).toBe(0);
    expect(length.length).toBeCloseTo(96);
    expect(length.worldAxis).toBe(2);
    expect(length.worldStart[0]).toBeCloseTo(length.worldEnd[0]);
    expect(length.worldStart[1]).toBeCloseTo(length.worldEnd[1]);
    expect(Math.abs(length.worldEnd[2] - length.worldStart[2])).toBeCloseTo(96);
  });

  it("follows a member rotated up onto Y and an explode offset", () => {
    const scene = compileDocument(STOOD_YAML).scene;
    expect(scene).toBeDefined();
    const member = scene!.components[0]!.members[0]!;
    const offsets = new Map<string, Vec3>([[member.key, [0, 5, 0]]]);
    const dimensions = extractSceneDimensions(scene!, offsets);
    expect(dimensions).toHaveLength(1);
    const length = dimensions[0]!;
    expect(length.worldAxis).toBe(1);
    expect(length.worldStart[1]).toBeCloseTo(5);
    expect(length.worldEnd[1] - length.worldStart[1]).toBeCloseTo(96);
  });
});
