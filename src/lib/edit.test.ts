import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import { DEMO_YAML } from "./demo";
import {
  deletePart,
  EditError,
  roundDegrees,
  roundInches,
  setPlacementPose,
  SNAP_DEG,
  SNAP_DEG_FINE,
  SNAP_INCH,
  SNAP_INCH_FINE,
  snapPosition,
  snapRotation,
} from "./edit";
import { instanceKey, parseInstanceKey } from "./fasteners";

const GLUE_THREE = `version: 1
name: Glue three
parts:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
  - label: C
    stock: 2x4x8
components:
  - label: Box
    parts:
      - { part: a-1, position: [0, 0, 0] }
      - { part: b-1, position: [8, 0, 0] }
      - { part: c-1, position: [16, 0, 0] }
    fasteners:
      - stock: wood-glue
        members:
          - { part: a-1, at: [0, 0.75, 0.75] }
          - { part: b-1, at: [0, 0.75, 0.75] }
          - { part: c-1, at: [0, 0.75, 0.75] }
`;

const SCREW_PAIR = `version: 1
name: Screw pair
parts:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
components:
  - label: Box
    parts:
      - { part: a-1, position: [0, 0, 0] }
      - { part: b-1, position: [8, 0, 0] }
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { part: a-1, at: [4, 0.75, 0.75], direction: [1, 0, 0] }
          - { part: b-1, at: [0, 0.75, 0.75], direction: [-1, 0, 0] }
`;

const BARE_PLACEMENT = `version: 1
name: Bare
parts:
  - label: A
    stock: 2x4x8
components:
  - label: Box
    parts:
      - { part: a-1 }
`;

describe("parseInstanceKey", () => {
  it("round-trips instanceKey", () => {
    const key = instanceKey("bench-1", "spare-block-1", 0);
    expect(parseInstanceKey(key)).toEqual({
      componentId: "bench-1",
      partId: "spare-block-1",
      placementIndex: 0,
    });
  });
});

describe("deletePart", () => {
  it("removes the spare block definition and its placement from the demo", () => {
    const next = deletePart(DEMO_YAML, "spare-block-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.parts.some((part) => part.id === "spare-block-1")).toBe(false);
    expect(
      result.document?.components.some((component) =>
        component.parts.some((placement) => placement.part === "spare-block-1"),
      ),
    ).toBe(false);
    expect(result.scene?.components.find((component) => component.id === "spare-1")?.parts).toEqual([]);
    expect(next).toContain("TrueCuts demo");
    expect(next).not.toContain("spare-block-1");
  });

  it("drops a two-member screw when one member's part is deleted", () => {
    const next = deletePart(SCREW_PAIR, "a-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.parts.map((part) => part.id)).toEqual(["b-1"]);
    expect(result.document?.components[0].parts).toHaveLength(1);
    expect(result.document?.components[0].fasteners).toEqual([]);
    expect(result.scene?.fasteners).toEqual([]);
  });

  it("keeps a glue fastener when it still has two members", () => {
    const next = deletePart(GLUE_THREE, "a-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.parts.map((part) => part.id)).toEqual(["b-1", "c-1"]);
    expect(result.document?.components[0].fasteners).toHaveLength(1);
    expect(result.document?.components[0].fasteners[0].members.map((member) => member.part)).toEqual([
      "b-1",
      "c-1",
    ]);
  });

  it("strips document-level fasteners that reference the part", () => {
    const next = deletePart(DEMO_YAML, "shelf-board-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.fasteners).toEqual([]);
    expect(result.document?.parts.some((part) => part.id === "shelf-board-1")).toBe(false);
  });

  it("throws for an unknown part", () => {
    expect(() => deletePart(DEMO_YAML, "nope-1")).toThrow(EditError);
  });
});

describe("setPlacementPose", () => {
  it("writes position and rotation onto the spare block", () => {
    const next = setPlacementPose(DEMO_YAML, "spare-1", 0, [1.2345, 5, 9.9999], [12.34, 0, -90.04]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components.find((component) => component.id === "spare-1")?.parts[0]).toMatchObject({
      part: "spare-block-1",
      position: [1.2345, 5, 9.9999],
      rotation: [12.3, 0, -90],
    });
  });

  it("adds omitted position and rotation keys", () => {
    const next = setPlacementPose(BARE_PLACEMENT, "box-1", 0, [3, 4, 5], [90, 0, 0]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0].parts[0]).toMatchObject({
      part: "a-1",
      position: [3, 4, 5],
      rotation: [90, 0, 0],
    });
    expect(next).toMatch(/position:\s*\[\s*3,\s*4,\s*5\s*\]/);
  });
});

describe("rounding", () => {
  it("keeps sixteenth-inch precision", () => {
    expect(roundInches(1)).toBe(1);
    expect(roundInches(1.23456)).toBe(1.2346);
    expect(roundDegrees(90)).toBe(90);
    expect(roundDegrees(12.34)).toBe(12.3);
  });
});

describe("snap", () => {
  it("snaps translation to half inches", () => {
    expect(snapPosition([1.24, 3.5, -0.2], SNAP_INCH)).toEqual([1, 3.5, 0]);
  });

  it("snaps translation to sixteenths when fine", () => {
    expect(snapPosition([1.04, 0, 0.04], SNAP_INCH_FINE)).toEqual([1.0625, 0, 0.0625]);
  });

  it("snaps rotation to 45° or 15°", () => {
    expect(snapRotation([40, 2, -10], SNAP_DEG)).toEqual([45, 0, 0]);
    expect(snapRotation([40, 2, -10], SNAP_DEG_FINE)).toEqual([45, 0, -15]);
  });
});
