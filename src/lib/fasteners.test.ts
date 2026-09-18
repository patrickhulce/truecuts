import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import { fastenedFromSeed, worldPoint } from "./fasteners";
import { rotateEulerXYZ } from "./geometry";
import { validateDocument } from "./schema";

describe("rotateEulerXYZ", () => {
  it("matches THREE Euler XYZ: +Z 90° sends X toward Y", () => {
    const rotated = rotateEulerXYZ([1, 0, 0], [0, 0, 90]);
    expect(rotated[0]).toBeCloseTo(0, 6);
    expect(rotated[1]).toBeCloseTo(1, 6);
    expect(rotated[2]).toBeCloseTo(0, 6);
  });

  it("lays plywood flat: +X 90° sends +Z toward -Y", () => {
    const rotated = rotateEulerXYZ([0, 0, 1], [90, 0, 0]);
    expect(rotated[0]).toBeCloseTo(0, 6);
    expect(rotated[1]).toBeCloseTo(-1, 6);
    expect(rotated[2]).toBeCloseTo(0, 6);
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
      [28.25, 0, 0.75],
      { part: "leg-1", position: [3.5, 0, 0], rotation: [0, 0, 90] },
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
parts:
  - { label: A, stock: 2x4x8 }
  - { label: B, stock: 2x4x8 }
  - { label: C, stock: 2x4x8 }
components:
  - label: Main
    parts:
      - { part: a-1 }
      - { part: b-1 }
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { part: a-1, at: [0, 0, 0], direction: [1, 0, 0] }
          - { part: b-1, at: [0, 0, 0], direction: [-1, 0, 0] }
  - label: Extra
    position: [20, 0, 0]
    parts:
      - { part: c-1 }
`;
    const result = compileDocument(yaml);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const parts = result.scene?.components.flatMap((component) => component.parts) ?? [];
    expect(parts.find((part) => part.partId === "a-1")?.fastened).toBe(true);
    expect(parts.find((part) => part.partId === "b-1")?.fastened).toBe(true);
    expect(parts.find((part) => part.partId === "c-1")?.fastened).toBe(false);
  });

  it("rejects fastener ids used as part stock", () => {
    const result = compileDocument(`
version: 1
name: Bad
parts:
  - { label: Screw, stock: screw-wood-8x2.5 }
components:
  - label: Box
    parts:
      - { part: screw-1 }
`);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics.some((item) => item.message.includes("not renderable as part stock"))).toBe(true);
  });

  it("meshes L-brackets as parts and lets screws go through them", () => {
    const result = compileDocument(`
version: 1
name: Bracket
parts:
  - { label: Leg, stock: 2x4x8 }
  - { label: Corner bracket, stock: bracket-l-2x2 }
components:
  - label: Box
    parts:
      - { part: leg-1, position: [0, 0, 0] }
      - { part: corner-bracket-1, position: [0, 0, 0] }
    fasteners:
      - stock: screw-wood-8x1.25
        members:
          - { part: corner-bracket-1, at: [0.125, 1, 1], direction: [-1, 0, 0] }
          - { part: leg-1, at: [0, 1, 1], direction: [1, 0, 0] }
`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.scene?.components[0].parts).toHaveLength(2);
    expect(result.scene?.components[0].parts.every((part) => part.fastened)).toBe(true);
    expect(result.scene?.fasteners).toHaveLength(1);
  });

  it("meshes flat L-brackets as parts and lets screws go through them", () => {
    const result = compileDocument(`
version: 1
name: FlatBracket
parts:
  - { label: Leg, stock: 2x4x8 }
  - { label: Flat bracket, stock: bracket-flat-l-2x1 }
components:
  - label: Box
    parts:
      - { part: leg-1, position: [0, 0, 0] }
      - { part: flat-bracket-1, position: [0, 0, 0] }
    fasteners:
      - stock: screw-wood-8x1.25
        members:
          - { part: flat-bracket-1, at: [0.5, 0.5, 0.125], direction: [0, 0, -1] }
          - { part: leg-1, at: [0.5, 0.5, 1.5], direction: [0, 0, 1] }
`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.scene?.components[0].parts).toHaveLength(2);
    expect(result.scene?.components[0].parts.every((part) => part.fastened)).toBe(true);
    expect(result.scene?.fasteners).toHaveLength(1);
  });

  it("rejects cuts on an L-bracket", () => {
    const result = compileDocument(`
version: 1
name: Bad
parts:
  - { label: Corner bracket, stock: bracket-l-2x2, cuts: [{ axis: 0, angle: 90, at: 1 }] }
`);
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics.some((item) => item.message.includes("cannot take planar cuts"))).toBe(true);
  });

  it("rejects cuts on a flat L-bracket", () => {
    const result = compileDocument(`
version: 1
name: Bad
parts:
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
      parts: [{ label: "A", stock: "2x4x8" }],
      components: [{ label: "Box", parts: [{ part: "a-1" }] }],
    });
    expect(issues).toEqual([]);
    expect(document?.fasteners).toEqual([]);
    expect(document?.components[0].fasteners).toEqual([]);
  });
});
