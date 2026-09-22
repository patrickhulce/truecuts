import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { compileDocument } from "./compile";
import { fastenedFromSeed, worldPoint } from "./fasteners";
import { degToRad, rotateEulerXYZ, type Vec3 } from "./geometry";
import { validateDocument } from "./schema";

describe("rotateEulerXYZ", () => {
  it("matches THREE Euler XYZ: +Z 90° sends X toward Y", () => {
    const rotated = rotateEulerXYZ([1, 0, 0], [0, 0, 90]);
    expect(rotated[0]).toBeCloseTo(0, 6);
    expect(rotated[1]).toBeCloseTo(1, 6);
    expect(rotated[2]).toBeCloseTo(0, 6);
  });

  it("lays plywood flat: identity keeps T along +Y", () => {
    const rotated = rotateEulerXYZ([0, 1, 0], [0, 0, 0]);
    expect(rotated[0]).toBeCloseTo(0, 6);
    expect(rotated[1]).toBeCloseTo(1, 6);
    expect(rotated[2]).toBeCloseTo(0, 6);
  });

  it("matches THREE.Euler XYZ for combined rotations", () => {
    const sample: Vec3 = [30, 1.5, 3.5];
    for (const rot of [
      [90, 0, 90],
      [90, 90, 0],
      [90, 0, -90],
    ] as Vec3[]) {
      const ours = rotateEulerXYZ(sample, rot);
      const three = new THREE.Vector3(...sample).applyEuler(
        new THREE.Euler(degToRad(rot[0]), degToRad(rot[1]), degToRad(rot[2]), "XYZ"),
      );
      expect(ours[0], `${rot}`).toBeCloseTo(three.x, 6);
      expect(ours[1], `${rot}`).toBeCloseTo(three.y, 6);
      expect(ours[2], `${rot}`).toBeCloseTo(three.z, 6);
    }
  });
});

describe("fastenedFromSeed", () => {
  it("marks only the seed when there are no edges", () => {
    const fastened = fastenedFromSeed(["a", "b", "c"], [], "a");
    expect([...fastened]).toEqual(["a"]);
  });

  it("walks undirected edges from the seed", () => {
    const fastened = fastenedFromSeed(["a", "b", "c", "d"], [["a", "b"], ["b", "c"]], "a");
    expect(fastened.has("a")).toBe(true);
    expect(fastened.has("b")).toBe(true);
    expect(fastened.has("c")).toBe(true);
    expect(fastened.has("d")).toBe(false);
  });
});

describe("worldPoint", () => {
  it("places a point on a standing 2x4", () => {
    const point = worldPoint(
      [28.25, 0.75, 3.5],
      { id: "leg-1", position: [0, 0, 0], rotation: [90, 90, 0] },
      { position: [0, 0, 0], rotation: [0, 0, 0] },
    );
    expect(point[0]).toBeCloseTo(3.5, 6);
    expect(point[1]).toBeCloseTo(28.25, 6);
    expect(point[2]).toBeCloseTo(0.75, 6);
  });
});

describe("fastener scene graph", () => {
  it("stripes isolated parts and keeps the seed fastened", () => {
    const yaml = `
version: 1
name: Graph
members:
  - { label: A, stock: 2x4x8 }
  - { label: B, stock: 2x4x8 }
  - { label: C, stock: 2x4x8 }
components:
  - label: Main
    members:
      - { id: a-1 }
      - { id: b-1 }
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { id: a-1, at: [0, 0, 0], direction: [1, 0, 0] }
          - { id: b-1, at: [0, 0, 0], direction: [-1, 0, 0] }
  - label: Extra
    position: [20, 0, 0]
    members:
      - { id: c-1 }
`;
    const result = compileDocument(yaml);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const parts = result.scene?.components.flatMap((component) => component.members) ?? [];
    expect(parts.find((part) => part.memberId === "a-1")?.fastened).toBe(true);
    expect(parts.find((part) => part.memberId === "b-1")?.fastened).toBe(true);
    expect(parts.find((part) => part.memberId === "c-1")?.fastened).toBe(false);
  });

  it("rejects fastener ids used as part stock", () => {
    const result = compileDocument(`
version: 1
name: Bad
members:
  - { label: Screw, stock: screw-wood-8x2.5 }
components:
  - label: Box
    members:
      - { id: screw-1 }
`);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics.some((item) => item.message.includes("not renderable as member stock"))).toBe(true);
  });

  it("meshes L-brackets as parts and lets screws go through them", () => {
    const result = compileDocument(`
version: 1
name: Bracket
members:
  - { label: Leg, stock: 2x4x8 }
  - { label: Corner bracket, stock: bracket-l-2x2 }
components:
  - label: Box
    members:
      - { id: leg-1, position: [0, 0, 0] }
      - { id: corner-bracket-1, position: [0, 0, 0] }
    fasteners:
      - stock: screw-wood-8x1.25
        members:
          - { id: corner-bracket-1, at: [0.125, 1, 1], direction: [-1, 0, 0] }
          - { id: leg-1, at: [0, 1, 1], direction: [1, 0, 0] }
`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.scene?.components[0].members).toHaveLength(2);
    expect(result.scene?.components[0].members.every((part) => part.fastened)).toBe(true);
    expect(result.scene?.fasteners).toHaveLength(1);
  });

  it("meshes flat L-brackets as parts and lets screws go through them", () => {
    const result = compileDocument(`
version: 1
name: FlatBracket
members:
  - { label: Leg, stock: 2x4x8 }
  - { label: Flat bracket, stock: bracket-flat-l-2x1 }
components:
  - label: Box
    members:
      - { id: leg-1, position: [0, 0, 0] }
      - { id: flat-bracket-1, position: [0, 0, 0] }
    fasteners:
      - stock: screw-wood-8x1.25
        members:
          - { id: flat-bracket-1, at: [0.5, 0.125, 0.5], direction: [0, -1, 0] }
          - { id: leg-1, at: [0.5, 1.5, 0.5], direction: [0, 1, 0] }
`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.scene?.components[0].members).toHaveLength(2);
    expect(result.scene?.components[0].members.every((part) => part.fastened)).toBe(true);
    expect(result.scene?.fasteners).toHaveLength(1);
  });

  it("rejects cuts on an L-bracket", () => {
    const result = compileDocument(`
version: 1
name: Bad
members:
  - { label: Corner bracket, stock: bracket-l-2x2, cuts: [{ axis: 0, angle: 90, at: 1 }] }
`);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics.some((item) => item.message.includes("cannot take planar cuts"))).toBe(true);
  });

  it("rejects cuts on a flat L-bracket", () => {
    const result = compileDocument(`
version: 1
name: Bad
members:
  - { label: Flat bracket, stock: bracket-flat-l-2x1, cuts: [{ axis: 0, angle: 90, at: 1 }] }
`);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics.some((item) => item.message.includes("cannot take planar cuts"))).toBe(true);
  });
});

describe("validateDocument fasteners default", () => {
  it("fills empty fastener lists", () => {
    const { document, issues } = validateDocument({
      version: 1,
      name: "Empty",
      members: [{ label: "A", stock: "2x4x8" }],
      components: [{ label: "Box", members: [{ id: "a-1" }] }],
    });
    expect(issues).toEqual([]);
    expect(document?.fasteners).toEqual([]);
    expect(document?.components[0].fasteners).toEqual([]);
  });
});
