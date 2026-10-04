import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { compileDocument } from "./compile";
import { applyPose, groupOrigin, placementAfterReseat, placementInNewGroup, rotateEulerXYZ, worldPlacementPose, type Vec3 } from "./geometry";
import { DEMO_YAML } from "./demo";
import {
  addConnection,
  addMember,
  defaultConnectionFastener,
  deleteMember,
  duplicateMember,
  duplicateMembers,
  EditError,
  groupMembers,
  parseCatalogDrag,
  promoteExplicitFasteners,
  roundDegrees,
  resizeMemberCut,
  roundInches,
  setComponentPose,
  setConnectionFastener,
  setMemberDimension,
  setPlacementPose,
  formatDocumentYaml,
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
members:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
  - label: C
    stock: 2x4x8
components:
  - label: Box
    members:
      - { id: a-1, position: [0, 0, 0] }
      - { id: b-1, position: [8, 0, 0] }
      - { id: c-1, position: [16, 0, 0] }
    fasteners:
      - stock: wood-glue
        members:
          - { id: a-1, at: [0, 0.75, 0.75] }
          - { id: b-1, at: [0, 0.75, 0.75] }
          - { id: c-1, at: [0, 0.75, 0.75] }
`;

const SCREW_PAIR = `version: 1
name: Screw pair
members:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
components:
  - label: Box
    members:
      - { id: a-1, position: [0, 0, 0] }
      - { id: b-1, position: [8, 0, 0] }
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { id: a-1, at: [4, 0.75, 0.75], direction: [1, 0, 0] }
          - { id: b-1, at: [0, 0.75, 0.75], direction: [-1, 0, 0] }
`;

const BARE_PLACEMENT = `version: 1
name: Bare
members:
  - label: A
    stock: 2x4x8
components:
  - label: Box
    members:
      - { id: a-1 }
`;

describe("parseInstanceKey", () => {
  it("round-trips instanceKey", () => {
    const key = instanceKey("bench-1", "spare-block-1", 0);
    expect(parseInstanceKey(key)).toEqual({
      componentId: "bench-1",
      memberId: "spare-block-1",
      placementIndex: 0,
    });
  });
});

describe("deleteMember", () => {
  it("removes the spare block definition and its placement from the demo", () => {
    const next = deleteMember(DEMO_YAML, "spare-block-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members.some((part) => part.id === "spare-block-1")).toBe(false);
    expect(
      result.document?.components.some((component) =>
        component.members.some((placement) => placement.id === "spare-block-1"),
      ),
    ).toBe(false);
    expect(result.scene?.components.find((component) => component.id === "spare-1")?.members).toEqual([]);
    expect(next).toContain("TrueCuts demo");
    expect(next).not.toContain("spare-block-1");
  });

  it("drops a two-member screw when one member's part is deleted", () => {
    const next = deleteMember(SCREW_PAIR, "a-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members.map((part) => part.id)).toEqual(["b-1"]);
    expect(result.document?.components[0].members).toHaveLength(1);
    expect(result.document?.components[0].fasteners).toEqual([]);
    expect(result.scene?.fasteners).toEqual([]);
  });

  it("keeps a glue fastener when it still has two members", () => {
    const next = deleteMember(GLUE_THREE, "a-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members.map((part) => part.id)).toEqual(["b-1", "c-1"]);
    expect(result.document?.components[0].fasteners).toHaveLength(1);
    expect(result.document?.components[0].fasteners[0].members.map((member) => member.id)).toEqual([
      "b-1",
      "c-1",
    ]);
  });

  it("strips document-level fasteners that reference the part", () => {
    const next = deleteMember(DEMO_YAML, "shelf-board-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.fasteners).toEqual([]);
    expect(result.document?.connections).toEqual([]);
    expect(result.document?.members.some((part) => part.id === "shelf-board-1")).toBe(false);
  });

  it("throws for an unknown part", () => {
    expect(() => deleteMember(DEMO_YAML, "nope-1")).toThrow(EditError);
  });

  it("keeps later derived ids when an earlier member is deleted", () => {
    const posts = `version: 1
name: Posts
members: [ { label: Post, stock: 6x6x8 }, { label: Post, stock: 6x6x8 }, { label: Post, stock: 6x6x8 } ]
components: [ { label: Build, members: [ { id: post-1, position: [0, 0, 0] }, { id: post-2, position: [10, 0, 0] }, { id: post-3, position: [20, 0, 0] } ], connections: [ { members: [ { id: post-2 }, { id: post-3 } ], fasteners: [ { kind: none } ] } ] } ]
`;
    const next = deleteMember(posts, "post-1");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.scene).toBeTruthy();
    expect(result.document?.members.map((part) => part.id)).toEqual(["post-2", "post-3"]);
    expect(result.document?.components[0].members.map((placement) => placement.id)).toEqual(["post-2", "post-3"]);
    expect(result.document?.components[0].connections[0].members.map((member) => member.id)).toEqual([
      "post-2",
      "post-3",
    ]);
  });
});

describe("setPlacementPose", () => {
  it("writes position and rotation onto the spare block", () => {
    const next = setPlacementPose(DEMO_YAML, "spare-1", 0, [1.2345, 5, 9.9999], [12.34, 0, -90.04]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components.find((component) => component.id === "spare-1")?.members[0]).toMatchObject({
      id: "spare-block-1",
      position: [1.2345, 5, 9.9999],
      rotation: [12.3, 0, -90],
    });
  });

  it("adds omitted position and rotation keys", () => {
    const next = setPlacementPose(BARE_PLACEMENT, "box-1", 0, [3, 4, 5], [90, 0, 0]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0].members[0]).toMatchObject({
      id: "a-1",
      position: [3, 4, 5],
      rotation: [90, 0, 0],
    });
    expect(next).toMatch(/position:\s*\[\s*3,\s*4,\s*5\s*\]/);
  });
});

describe("setConnectionFastener", () => {
  it("round-trips kind, stock, and variant", () => {
    const start = `${SCREW_PAIR.replace(
      "fasteners:",
      `connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: screw, stock: screw-wood-8x2.5, variant: { kind: centered, separation: 4, justify: space-around } }
    fasteners:`,
    )}`;
    const asGlue = setConnectionFastener(start, "box-1", 0, 0, {
      kind: "glue",
      stock: "wood-glue",
      variant: { kind: "edge", edge: 0.5 },
    });
    const glued = compileDocument(asGlue);
    expect(glued.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(glued.document?.components[0].connections[0].fasteners[0]).toEqual({
      kind: "glue",
      stock: "wood-glue",
      variant: { kind: "edge", edge: 0.5 },
    });

    const asPerimeter = setConnectionFastener(asGlue, "box-1", 0, 0, {
      kind: "screw",
      stock: "screw-wood-8x2",
      variant: { kind: "perimeter", edge: 0.75, separation: 6, justify: "space-between" },
    });
    const screwed = compileDocument(asPerimeter);
    expect(screwed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(screwed.document?.components[0].connections[0].fasteners[0]).toMatchObject({
      kind: "screw",
      stock: "screw-wood-8x2",
      variant: { kind: "perimeter", edge: 0.75, separation: 6, justify: "space-between" },
    });
  });
});

describe("promoteExplicitFasteners", () => {
  it("turns an explicit screw into a connection recipe and drops the explicit entry", () => {
    const next = promoteExplicitFasteners(SCREW_PAIR, "box-1", [0]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0].fasteners).toEqual([]);
    expect(result.document?.components[0].connections).toHaveLength(1);
    expect(result.document?.components[0].connections[0].members.map((member) => member.id)).toEqual(["a-1", "b-1"]);
    expect(result.document?.components[0].connections[0].fasteners[0]).toEqual(defaultConnectionFastener("screw-wood-8x2.5"));
  });
});

const COMMENTED = `# keep me
version: 1
name: Box
members:
  - label: A
    stock: 2x4x8
components:
  - label: Box
    members:
      - { id: a-1, position: [0, 0, 0] }
`;

describe("addMember", () => {
  it("appends a member and a placement without dropping comments", () => {
    const next = addMember(COMMENTED, {
      label: "Leg",
      stock: "2x4x8",
      cuts: [{ axis: 0, angle: 90, at: 30 }],
    });
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(next).toContain("# keep me");
    expect(result.document?.members.map((part) => part.id)).toEqual(["a-1", "leg-1"]);
    expect(result.document?.members[1]).toMatchObject({
      label: "Leg",
      stock: "2x4x8",
      cuts: [{ axis: 0, angle: 90, at: 30, side: "end" }],
    });
    expect(result.document?.components[0].members[1]).toMatchObject({
      id: "leg-1",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
  });

  it("writes a parametric size override", () => {
    const next = addMember(COMMENTED, { label: "Cap", stock: "connector-t", size: [7, 6] });
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members.find((part) => part.id === "cap-1")?.size).toEqual([7, 6, 0.25]);
  });

  it("creates a Build component when the document has none", () => {
    const next = addMember("version: 1\nname: Empty\n", { label: "Board", stock: "2x4x8" });
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0]).toMatchObject({ id: "build-1", label: "Build" });
    expect(result.document?.components[0].members[0]).toMatchObject({
      id: "board-1",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
  });

  it("numbers a repeated label", () => {
    const next = addMember(COMMENTED, { label: "A", stock: "2x4x8" });
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0].members.map((placement) => placement.id)).toEqual(["a-1", "a-2"]);
  });

  it("rejects a blank label", () => {
    expect(() => addMember(COMMENTED, { label: "  ", stock: "2x4x8" })).toThrow(EditError);
  });

  it("does not renumber a component that shares the new member's label", () => {
    const shared = `version: 1
name: Shared
members:
  - { label: Build, stock: 2x4x8 }
  - { label: Rail, stock: 2x4x8 }
components:
  - label: Build
    members:
      - { id: build-1, position: [0, 0, 0] }
      - { id: rail-1, position: [8, 0, 0] }
connections:
  - members:
      - { component: build-2, id: build-1 }
      - { component: build-2, id: rail-1 }
    fasteners:
      - { kind: none }
`;
    const next = addMember(shared, { label: "Build", stock: "2x4x8" });
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.scene).toBeTruthy();
    expect(result.document?.members.map((part) => part.id)).toEqual(["build-1", "rail-1", "build-3"]);
    expect(result.document?.components.map((component) => component.id)).toEqual(["build-2"]);
    expect(result.document?.connections[0].members.map((member) => member.component)).toEqual(["build-2", "build-2"]);
  });

  it("places into the requested component at the drop point", () => {
    const split = `${COMMENTED}  - label: Extra
    members: []
`;
    const next = addMember(split, {
      label: "Leg",
      stock: "2x4x8",
      componentId: "extra-1",
      position: [4, 0, 8],
      rotation: [0, 0, 0],
    });
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components.find((component) => component.id === "box-1")?.members).toHaveLength(1);
    expect(result.document?.components.find((component) => component.id === "extra-1")?.members[0]).toMatchObject({
      id: "leg-1",
      position: [4, 0, 8],
      rotation: [0, 0, 0],
    });
  });
});

describe("addConnection", () => {
  const pair = `version: 1
name: Pair
members:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
components:
  - label: Box
    members:
      - { id: a-1, position: [0, 0, 0] }
      - { id: b-1, position: [4, 0, 0] }
`;

  it("appends a none connection on the shared component", () => {
    const next = addConnection(pair, [
      { componentId: "box-1", id: "a-1" },
      { componentId: "box-1", id: "b-1" },
    ]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0].connections).toEqual([
      { members: [{ component: "box-1", id: "a-1", index: 0 }, { component: "box-1", id: "b-1", index: 0 }], fasteners: [{ kind: "none" }] },
    ]);
  });

  it("writes a document-level connection when the members are in different components", () => {
    const split = `version: 1
name: Split
members:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
components:
  - label: Left
    members:
      - { id: a-1, position: [0, 0, 0] }
  - label: Right
    members:
      - { id: b-1, position: [4, 0, 0] }
`;
    const next = addConnection(split, [
      { componentId: "left-1", id: "a-1" },
      { componentId: "right-1", id: "b-1", index: 0 },
    ]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.connections[0]?.members).toEqual([
      { component: "left-1", id: "a-1", index: 0 },
      { component: "right-1", id: "b-1", index: 0 },
    ]);
    expect(result.document?.connections[0]?.fasteners).toEqual([{ kind: "none" }]);
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

describe("setMemberDimension", () => {
  const cutBoard = `version: 1
name: Cut
members:
  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 30 }
components:
  - label: Box
    members:
      - { id: leg-1, position: [0, 0, 0] }
`;

  it("adds a square crosscut when fixed stock is shortened", () => {
    const next = setMemberDimension(COMMENTED, "a-1", 0, 30);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([{ axis: 0, angle: 90, at: 30, side: "end" }]);
  });

  it("moves the only square crosscut", () => {
    const next = setMemberDimension(cutBoard, "leg-1", 0, 36);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts[0]).toMatchObject({ axis: 0, at: 36 });
  });

  it("removes the crosscut when the length returns to full stock", () => {
    const next = setMemberDimension(cutBoard, "leg-1", 0, 96);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([]);
  });

  it("writes a parametric size override", () => {
    const next = setMemberDimension(COMMENTED.replace("stock: 2x4x8", "stock: connector-t"), "a-1", 0, 7);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].size).toEqual([7, 5.5, 0.25]);
  });

  it("adds a second dimension cut alongside the first", () => {
    const panel = cutBoard.replace("stock: 2x4x8", "stock: plywood-3/4-4x8").replace("at: 30", "at: 60");
    const next = setMemberDimension(panel, "leg-1", 1, 24);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 60, side: "end" },
      { axis: 1, angle: 90, at: 24, side: "end" },
    ]);
  });

  it("rips a board that already has a crosscut", () => {
    const next = setMemberDimension(cutBoard, "leg-1", 1, 2);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 30, side: "end" },
      { axis: 1, angle: 90, at: 2, side: "end" },
    ]);
  });

  it("moves and removes only the cut on its own axis", () => {
    const both = setMemberDimension(cutBoard, "leg-1", 1, 2);
    const moved = compileDocument(setMemberDimension(both, "leg-1", 1, 2.5));
    expect(moved.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 30, side: "end" },
      { axis: 1, angle: 90, at: 2.5, side: "end" },
    ]);
    const widened = compileDocument(setMemberDimension(both, "leg-1", 1, 3.5));
    expect(widened.document?.members[0].cuts).toEqual([{ axis: 0, angle: 90, at: 30, side: "end" }]);
    const lengthened = compileDocument(setMemberDimension(both, "leg-1", 0, 36));
    expect(lengthened.document?.members[0].cuts[0]).toMatchObject({ axis: 0, at: 36 });
  });

  it("measures from the start cut when both ends are cut", () => {
    const bothEnds = cutBoard.replace(
      "- { axis: 0, angle: 90, at: 30 }",
      "- { axis: 0, angle: 90, at: 60 }\n      - { axis: 0, angle: 90, at: 12, side: start }",
    );
    const moved = compileDocument(setMemberDimension(bothEnds, "leg-1", 0, 36));
    expect(moved.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 48, side: "end" },
      { axis: 0, angle: 90, at: 12, side: "start" },
    ]);
    const full = compileDocument(setMemberDimension(bothEnds, "leg-1", 0, 84));
    expect(full.document?.members[0].cuts).toEqual([{ axis: 0, angle: 90, at: 12, side: "start" }]);
    expect(() => setMemberDimension(bothEnds, "leg-1", 0, 90)).toThrow(/remaining stock/);
  });

  it("leaves the document alone when the dimension already matches", () => {
    expect(setMemberDimension(cutBoard, "leg-1", 0, 30)).toBe(cutBoard);
    expect(setMemberDimension(cutBoard, "leg-1", 1, 3.5)).toBe(cutBoard);
  });

  it("rejects a longer-than-stock length, a fixed axis, and non-square cuts on that axis", () => {
    expect(() => setMemberDimension(COMMENTED, "a-1", 0, 120)).toThrow(/longer than stock/);
    expect(() => setMemberDimension(COMMENTED.replace("stock: 2x4x8", "stock: bracket-l-1.5x1.5"), "a-1", 0, 1)).toThrow(
      /fixed/,
    );
    const mitered = cutBoard.replace("angle: 90, at: 30", "angle: 45, at: [20, 40]");
    expect(() => setMemberDimension(mitered, "leg-1", 0, 50)).toThrow(/Edit cuts in YAML/);
    const duplicated = cutBoard.replace("at: 30 }", "at: 30 }\n      - { axis: 0, angle: 90, at: 40 }");
    expect(() => setMemberDimension(duplicated, "leg-1", 0, 50)).toThrow(/Edit cuts in YAML/);
  });
});

describe("resizeMemberCut", () => {
  const cutBoard = `version: 1
name: Cut
members:
  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 30 }
components:
  - label: Box
    members:
      - { id: leg-1, position: [0, 0, 0] }
`;

  it("adds a square crosscut when fixed stock is shortened", () => {
    const next = resizeMemberCut(COMMENTED, "a-1", 0, 30);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([{ axis: 0, angle: 90, at: 30, side: "end" }]);
  });

  it("moves the square cut on that axis", () => {
    const next = resizeMemberCut(cutBoard, "leg-1", 0, 36);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts[0]).toMatchObject({ axis: 0, at: 36, side: "end" });
  });

  it("removes the cut when the plane returns to the stock end", () => {
    const next = resizeMemberCut(cutBoard, "leg-1", 0, 96);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([]);
  });

  it("keeps cuts on other axes when a new square cut is added", () => {
    const next = resizeMemberCut(cutBoard, "leg-1", 1, 2);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 30, side: "end" },
      { axis: 1, angle: 90, at: 2, side: "end" },
    ]);
  });

  it("moves a start cut and drops it at the origin", () => {
    const started = cutBoard.replace("at: 30", 'at: 10, side: start');
    const moved = compileDocument(resizeMemberCut(started, "leg-1", 0, 4));
    expect(moved.document?.members[0].cuts[0]).toMatchObject({ axis: 0, at: 4, side: "start" });
    const cleared = compileDocument(resizeMemberCut(started, "leg-1", 0, 0));
    expect(cleared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(cleared.document?.members[0].cuts).toEqual([]);
  });

  it("writes a parametric size override", () => {
    const next = resizeMemberCut(COMMENTED.replace("stock: 2x4x8", "stock: connector-t"), "a-1", 0, 7);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].size).toEqual([7, 5.5, 0.25]);
  });

  it("cuts the face you drag: the near face trims the start, the far face the end", () => {
    const panel = cutBoard.replace("stock: 2x4x8", "stock: plywood-3/4-4x8").replace("at: 30", "at: 60");
    const fromNear = compileDocument(resizeMemberCut(panel, "leg-1", 1, 6, "start"));
    expect(fromNear.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(fromNear.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 60, side: "end" },
      { axis: 1, angle: 90, at: 6, side: "start" },
    ]);
    const fromFar = compileDocument(resizeMemberCut(panel, "leg-1", 1, 30, "end"));
    expect(fromFar.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 60, side: "end" },
      { axis: 1, angle: 90, at: 30, side: "end" },
    ]);
  });

  it("moves only the face named by side when both ends are cut", () => {
    const bothEnds = cutBoard.replace(
      "- { axis: 0, angle: 90, at: 30 }",
      "- { axis: 0, angle: 90, at: 60 }\n      - { axis: 0, angle: 90, at: 12, side: start }",
    );
    const near = compileDocument(resizeMemberCut(bothEnds, "leg-1", 0, 8, "start"));
    expect(near.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 60, side: "end" },
      { axis: 0, angle: 90, at: 8, side: "start" },
    ]);
    const far = compileDocument(resizeMemberCut(bothEnds, "leg-1", 0, 80, "end"));
    expect(far.document?.members[0].cuts).toEqual([
      { axis: 0, angle: 90, at: 80, side: "end" },
      { axis: 0, angle: 90, at: 12, side: "start" },
    ]);
    expect(() => resizeMemberCut(bothEnds, "leg-1", 0, 70, "start")).toThrow(/remove the whole/);
  });

  it("lengthens a short board from the uncut origin and keeps the far face put", () => {
    const short = `version: 1
name: Short
members:
  - label: Leg
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 12 }
    bores:
      - { face: LxW@1, at: [6, 1.75], diameter: 0.25, depth: 0.5 }
      - { face: WxT@0, at: [1.75, 0.75], diameter: 0.25, depth: 0.5 }
components:
  - label: Box
    members:
      - { id: leg-1, position: [10, 0, 5], rotation: [0, 90, 0] }
      - { id: leg-1, position: [0, 0, 30], rotation: [0, 0, 0] }
`;
    const before = compileDocument(short);
    const next = resizeMemberCut(short, "leg-1", 0, -6, "start");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([{ axis: 0, angle: 90, at: 18, side: "end" }]);
    expect(result.document?.members[0].bores[0].at).toEqual([12, 1.75]);
    expect(result.document?.members[0].bores[1].at).toEqual([1.75, 0.75]);
    const placements = result.document?.components[0].members ?? [];
    expect(placements.map((placement) => placement.position)).toEqual([
      [10, 0, 11],
      [-6, 0, 30],
    ]);
    const oldEnd = applyPose([12, 0, 0], [10, 0, 5], [0, 90, 0]);
    const newEnd = applyPose([18, 0, 0], placements[0].position, [0, 90, 0]);
    expect(newEnd[0]).toBeCloseTo(oldEnd[0]);
    expect(newEnd[1]).toBeCloseTo(oldEnd[1]);
    expect(newEnd[2]).toBeCloseTo(oldEnd[2]);
    const oldBore = applyPose([6, 1.5, 1.75], [10, 0, 5], [0, 90, 0]);
    const newBore = applyPose([12, 1.5, 1.75], placements[0].position, [0, 90, 0]);
    expect(newBore[0]).toBeCloseTo(oldBore[0]);
    expect(newBore[1]).toBeCloseTo(oldBore[1]);
    expect(newBore[2]).toBeCloseTo(oldBore[2]);
    const stationary = before.document?.components[0].members[0];
    expect(stationary?.position).toEqual([10, 0, 5]);
  });

  it("lengthens from the uncut far end when the cut is on the start", () => {
    const started = cutBoard.replace(
      "- { axis: 0, angle: 90, at: 30 }",
      "- { axis: 0, angle: 90, at: 84, side: start }",
    );
    const placed = started.replace("position: [0, 0, 0]", "position: [10, 0, 0]");
    const next = resizeMemberCut(placed, "leg-1", 0, 102, "end");
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].cuts).toEqual([{ axis: 0, angle: 90, at: 78, side: "start" }]);
    expect(result.document?.components[0].members[0].position).toEqual([16, 0, 0]);
  });

  it("does not move the placement when the dragged face stays inside the stock", () => {
    const placed = cutBoard.replace("position: [0, 0, 0]", "position: [10, 0, 4]");
    const next = resizeMemberCut(placed, "leg-1", 0, 36);
    expect(compileDocument(next).document?.components[0].members[0].position).toEqual([10, 0, 4]);
  });

  it("rejects a cut past the stock, a fixed axis, and an angled cut on the same axis", () => {
    expect(() => resizeMemberCut(COMMENTED, "a-1", 0, 120)).toThrow(/extend past the stock/);
    expect(() => resizeMemberCut(COMMENTED, "a-1", 0, -1)).toThrow(/extend past the stock/);
    const oneFoot = cutBoard.replace("at: 30", "at: 12");
    expect(() => resizeMemberCut(oneFoot, "leg-1", 0, -90, "start")).toThrow(/extend past the stock/);
    expect(() => resizeMemberCut(oneFoot, "leg-1", 0, 100, "end")).toThrow(/extend past the stock/);
    expect(() =>
      resizeMemberCut(COMMENTED.replace("stock: 2x4x8", "stock: bracket-l-1.5x1.5"), "a-1", 2, 0.2),
    ).toThrow(/fixed/);
    const angled = cutBoard.replace("angle: 90, at: 30", "angle: 45, at: [20, 40]");
    expect(() => resizeMemberCut(angled, "leg-1", 0, 50)).toThrow(/Edit cuts in YAML/);
  });
});

describe("duplicateMember", () => {
  const bored = `version: 1
name: Box
members:
  - label: A
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 20 }
    bores:
      - { face: LxW@1, at: [4, 1], diameter: 0.25, depth: 0.5 }
components:
  - label: Box
    members:
      - { id: a-1, position: [1, 2, 3], rotation: [0, 90, 0] }
`;

  it("clones the definition and places a copy with the same rotation", () => {
    const next = duplicateMember(bored, "a-1", "box-1", [8, 2, 3], [0, 90, 0]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members.map((part) => part.id)).toEqual(["a-1", "a-2"]);
    expect(result.document?.members[1]).toMatchObject({
      label: "A",
      stock: "2x4x8",
      cuts: [{ axis: 0, angle: 90, at: 20, side: "end" }],
    });
    expect(result.document?.members[1].bores).toHaveLength(1);
    expect(result.document?.components[0].members[1]).toMatchObject({
      id: "a-2",
      position: [8, 2, 3],
      rotation: [0, 90, 0],
    });
    expect(result.document?.components[0].members[0].position).toEqual([1, 2, 3]);
  });
});

const JOINED = `version: 1
name: Joints
members:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
  - label: C
    stock: 2x4x8
  - label: Shelf
    stock: 2x4x8
  - label: Bracket
    stock: bracket-l-2x2
components:
  - label: Box
    members:
      - { id: a-1, position: [0, 0, 0] }
      - { id: b-1, position: [4, 0, 0] }
      - { id: c-1, position: [0, 4, 0] }
      - { id: bracket-1, position: [1, 1, 1] }
    connections:
      - members:
          - { id: a-1, index: 0 }
          - { id: b-1 }
        fasteners:
          - { kind: screw, stock: screw-wood-8x2.5, variant: { kind: centered, separation: 4, justify: space-around } }
      - members:
          - { id: a-1 }
          - { id: c-1 }
        fasteners:
          - { kind: none }
      - members:
          - { id: bracket-1 }
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: screw, stock: screw-wood-8x1.25, variant: { kind: angle-bracket, bracket: bracket-1, edge: 0.25 } }
  - label: Rack
    members:
      - { id: shelf-1, position: [0, 0, 0] }
connections:
  - members:
      - { component: box-1, id: b-1 }
      - { component: rack-1, id: shelf-1 }
    fasteners:
      - { kind: glue, stock: wood-glue }
`;

describe("duplicateMembers", () => {
  function copy(ids: Array<{ memberId: string; componentId: string; occurrence?: number }>) {
    return duplicateMembers(
      JOINED,
      ids.map((item) => ({
        memberId: item.memberId,
        componentId: item.componentId,
        occurrence: item.occurrence ?? 0,
        position: [10, 0, 0],
        rotation: [0, 0, 0],
      })),
    );
  }

  it("clones a component connection onto the new ids and keeps the original", () => {
    const next = copy([
      { memberId: "a-1", componentId: "box-1" },
      { memberId: "b-1", componentId: "box-1" },
    ]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const connections = result.document?.components[0].connections ?? [];
    expect(connections).toHaveLength(4);
    expect(connections[0].members.map((member) => member.id)).toEqual(["a-1", "b-1"]);
    expect(connections[3].members.map((member) => member.id)).toEqual(["a-2", "b-2"]);
    expect(connections[3].fasteners[0]).toMatchObject({
      kind: "screw",
      stock: "screw-wood-8x2.5",
    });
    const raw = parse(next) as {
      components: Array<{ connections: Array<{ members: Array<{ id: string; index?: number }> }> }>;
    };
    expect(raw.components[0].connections[3].members[0]).toEqual({ id: "a-2" });
  });

  it("does not copy a connection when only one member is pasted", () => {
    const next = copy([{ memberId: "a-1", componentId: "box-1" }]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0].connections).toHaveLength(3);
    expect(result.document?.connections).toHaveLength(1);
  });

  it("leaves a connection that reaches outside the selection", () => {
    const next = copy([
      { memberId: "a-1", componentId: "box-1" },
      { memberId: "b-1", componentId: "box-1" },
    ]);
    const result = compileDocument(next);
    const connections = result.document?.components[0].connections ?? [];
    expect(connections.filter((connection) => connection.members.some((member) => member.id === "c-1"))).toHaveLength(1);
    expect(connections.some((connection) => connection.members.some((member) => member.id === "c-2"))).toBe(false);
  });

  it("clones a document-level connection when every member was pasted", () => {
    const partial = copy([{ memberId: "b-1", componentId: "box-1" }]);
    expect(compileDocument(partial).document?.connections).toHaveLength(1);

    const next = copy([
      { memberId: "b-1", componentId: "box-1" },
      { memberId: "shelf-1", componentId: "rack-1" },
    ]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.connections).toEqual([
      {
        members: [
          { component: "box-1", id: "b-1", index: 0 },
          { component: "rack-1", id: "shelf-1", index: 0 },
        ],
        fasteners: [{ kind: "glue", stock: "wood-glue", variant: { kind: "patch" } }],
      },
      {
        members: [
          { component: "box-1", id: "b-2", index: 0 },
          { component: "rack-1", id: "shelf-2", index: 0 },
        ],
        fasteners: [{ kind: "glue", stock: "wood-glue", variant: { kind: "patch" } }],
      },
    ]);
  });

  it("remaps an angle-bracket id", () => {
    const next = copy([
      { memberId: "bracket-1", componentId: "box-1" },
      { memberId: "a-1", componentId: "box-1" },
      { memberId: "b-1", componentId: "box-1" },
    ]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const copied = result.document?.components[0].connections.find((connection) =>
      connection.members.some((member) => member.id === "bracket-2"),
    );
    expect(copied?.members.map((member) => member.id)).toEqual(["bracket-2", "a-2", "b-2"]);
    expect(copied?.fasteners[0]).toMatchObject({
      kind: "screw",
      variant: { kind: "angle-bracket", bracket: "bracket-2", edge: 0.25 },
    });
  });

  it("clones an explicit fastener with at and direction intact", () => {
    const next = duplicateMembers(SCREW_PAIR, [
      { memberId: "a-1", componentId: "box-1", occurrence: 0, position: [10, 0, 0], rotation: [0, 0, 0] },
      { memberId: "b-1", componentId: "box-1", occurrence: 0, position: [18, 0, 0], rotation: [0, 0, 0] },
    ]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const fasteners = result.document?.components[0].fasteners ?? [];
    expect(fasteners).toHaveLength(2);
    expect(fasteners[0].members.map((member) => member.id)).toEqual(["a-1", "b-1"]);
    expect(fasteners[1].members).toEqual([
      { component: "box-1", id: "a-2", index: 0, at: [4, 0.75, 0.75], direction: [1, 0, 0] },
      { component: "box-1", id: "b-2", index: 0, at: [0, 0.75, 0.75], direction: [-1, 0, 0] },
    ]);
  });
});

describe("parseCatalogDrag", () => {
  it("reads a catalog drop payload", () => {
    expect(parseCatalogDrag(JSON.stringify({ label: "Board", stock: "2x4x8", cuts: [{ axis: 0, angle: 90, at: 24 }] }))).toEqual({
      label: "Board",
      stock: "2x4x8",
      size: undefined,
      cuts: [{ axis: 0, angle: 90, at: 24 }],
    });
    expect(parseCatalogDrag("not json")).toBeNull();
  });
});

function closeVec(actual: Vec3, expected: Vec3, digits = 3) {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe("setComponentPose", () => {
  it("writes the component position and rotation", () => {
    const next = setComponentPose(BARE_PLACEMENT, "box-1", [1, 2, 3], [0, 90, 0]);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0]).toMatchObject({
      position: [1, 2, 3],
      rotation: [0, 90, 0],
    });
  });
});

describe("groupMembers", () => {
  const rotated = `version: 1
name: Rotated
members:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
  - label: C
    stock: 2x4x8
components:
  - id: box-1
    label: Box
    position: [10, 0, 4]
    rotation: [0, 90, 0]
    members:
      - { id: a-1, position: [2, 0, 0], rotation: [0, 0, 0] }
      - { id: b-1, position: [2, 0, 8], rotation: [90, 0, 0] }
  - id: rack-1
    label: Rack
    members:
      - { id: c-1, position: [0, 0, 0], rotation: [0, 0, 0] }
`;

  it("groups a rotated parent onto the bounds origin and drops the empty source", () => {
    const before = compileDocument(rotated);
    expect(before.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const box = before.scene?.components.find((component) => component.id === "box-1");
    if (!box) throw new Error("missing box");
    const origin = groupOrigin(box.members.map((member) => member.worldBounds));
    if (!origin) throw new Error("missing origin");
    const items = box.members.map((part) => {
      const world = worldPlacementPose(part, box);
      const local = placementInNewGroup(world, origin);
      const { placementIndex } = parseInstanceKey(part.key);
      return { componentId: box.id, placementIndex, position: local.position, rotation: local.rotation };
    });
    const grouped = groupMembers(rotated, items, origin);
    const after = compileDocument(grouped.text);
    expect(after.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(after.document?.components.map((component) => component.id)).toEqual(["rack-1", grouped.componentId]);
    expect(grouped.componentId).toBe("group-1");
    const group = after.document?.components.find((component) => component.id === grouped.componentId);
    expect(group?.position).toEqual(origin.map((value) => roundInches(value)) as Vec3);
    expect(group?.rotation).toEqual([0, 0, 0]);
    const sceneGroup = after.scene?.components.find((component) => component.id === grouped.componentId);
    if (!sceneGroup || !group) throw new Error("missing group");
    for (const part of box.members) {
      const placed = sceneGroup.members.find((member) => member.memberId === part.memberId);
      if (!placed) throw new Error(`missing ${part.memberId}`);
      closeVec(applyPose(placed.position, sceneGroup.position, sceneGroup.rotation), worldPlacementPose(part, box).position);
      const sample: Vec3 = [3, 1, 2];
      closeVec(
        rotateEulerXYZ(rotateEulerXYZ(sample, placed.rotation), sceneGroup.rotation),
        rotateEulerXYZ(rotateEulerXYZ(sample, part.rotation), box.rotation),
        2,
      );
    }
  });

  it("reseats an existing component without moving world pivots or its rotation", () => {
    const before = compileDocument(rotated);
    const box = before.scene?.components.find((component) => component.id === "box-1");
    if (!box) throw new Error("missing box");
    const origin = groupOrigin(box.members.map((member) => member.worldBounds));
    if (!origin) throw new Error("missing origin");
    const items = box.members.map((part) => {
      const world = worldPlacementPose(part, box);
      const { placementIndex } = parseInstanceKey(part.key);
      return {
        componentId: box.id,
        placementIndex,
        position: placementAfterReseat(world.position, origin, box.rotation),
        rotation: part.rotation,
      };
    });
    const reseated = groupMembers(rotated, items, origin, box.id);
    const after = compileDocument(reseated.text);
    expect(after.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(reseated.componentId).toBe("box-1");
    expect(after.document?.components.map((component) => component.id)).toEqual(["box-1", "rack-1"]);
    const next = after.document?.components[0];
    expect(next?.rotation).toEqual([0, 90, 0]);
    expect(next?.position).toEqual(origin.map((value) => roundInches(value)) as Vec3);
    const sceneBox = after.scene?.components[0];
    if (!sceneBox) throw new Error("missing reseated box");
    for (const part of box.members) {
      const placed = sceneBox.members.find((member) => member.memberId === part.memberId);
      if (!placed) throw new Error(`missing ${part.memberId}`);
      closeVec(applyPose(placed.position, sceneBox.position, sceneBox.rotation), worldPlacementPose(part, box).position);
      expect(placed.rotation.map((value) => roundDegrees(value))).toEqual(part.rotation.map((value) => roundDegrees(value)));
    }
  });

  it("moves internal joints onto the group and promotes a joint that spans the cut", () => {
    const start = `version: 1
name: Joints
members:
  - label: A
    stock: 2x4x8
  - label: B
    stock: 2x4x8
  - label: C
    stock: 2x4x8
components:
  - id: box-1
    label: Box
    members:
      - { id: a-1, position: [0, 0, 0], rotation: [0, 0, 0] }
      - { id: a-1, position: [12, 0, 0], rotation: [0, 0, 0] }
      - { id: b-1, position: [0, 4, 0], rotation: [0, 0, 0] }
      - { id: c-1, position: [0, 8, 0], rotation: [0, 0, 0] }
    connections:
      - members:
          - { id: a-1, index: 0 }
          - { id: b-1 }
        fasteners:
          - { kind: none }
      - members:
          - { id: a-1, index: 1 }
          - { id: c-1 }
        fasteners:
          - { kind: none }
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { id: a-1, index: 0, at: [1, 0, 1], direction: [1, 0, 0] }
          - { id: b-1, at: [0, 0, 1], direction: [-1, 0, 0] }
  - id: rack-1
    label: Rack
    members:
      - { id: c-1, position: [30, 0, 0], rotation: [0, 0, 0] }
connections:
  - members:
      - { component: box-1, id: b-1 }
      - { component: rack-1, id: c-1 }
    fasteners:
      - { kind: none }
`;
    const before = compileDocument(start);
    expect(before.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const box = before.scene?.components.find((component) => component.id === "box-1");
    if (!box) throw new Error("missing box");
    const selected = box.members.filter((member) => member.memberId === "b-1" || member.key.endsWith("#0"));
    const origin = groupOrigin(selected.map((member) => member.worldBounds));
    if (!origin) throw new Error("missing origin");
    const items = selected.map((part) => {
      const world = worldPlacementPose(part, box);
      const local = placementInNewGroup(world, origin);
      const { placementIndex } = parseInstanceKey(part.key);
      return { componentId: box.id, placementIndex, position: local.position, rotation: local.rotation };
    });
    const grouped = groupMembers(start, items, origin);
    const after = compileDocument(grouped.text);
    expect(after.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const group = after.document?.components.find((component) => component.id === grouped.componentId);
    const source = after.document?.components.find((component) => component.id === "box-1");
    expect(group?.members.map((member) => member.id)).toEqual(["a-1", "b-1"]);
    expect(source?.members.map((member) => member.id)).toEqual(["a-1", "c-1"]);
    expect(group?.connections.map((connection) => connection.members.map((member) => member.id))).toEqual([["a-1", "b-1"]]);
    expect(group?.fasteners[0]?.members.map((member) => member.id)).toEqual(["a-1", "b-1"]);
    expect(source?.connections.map((connection) => connection.members.map((member) => `${member.id}#${member.index}`))).toEqual([
      ["a-1#0", "c-1#0"],
    ]);
    expect(after.document?.connections).toEqual([
      {
        members: [
          { component: grouped.componentId, id: "b-1", index: 0 },
          { component: "rack-1", id: "c-1", index: 0 },
        ],
        fasteners: [{ kind: "none" }],
      },
    ]);
    expect(after.document?.fasteners ?? []).toEqual([]);
  });
});

describe("snap", () => {
  it("snaps translation to whole inches", () => {
    expect(snapPosition([1.24, 3.5, -0.2], SNAP_INCH)).toEqual([1, 4, 0]);
  });

  it("snaps translation to eighths when fine", () => {
    expect(snapPosition([1.1, 0, 0.1], SNAP_INCH_FINE)).toEqual([1.125, 0, 0.125]);
  });

  it("snaps rotation to 45° or 15°", () => {
    expect(snapRotation([40, 2, -10], SNAP_DEG)).toEqual([45, 0, 0]);
    expect(snapRotation([40, 2, -10], SNAP_DEG_FINE)).toEqual([45, 0, -15]);
  });
});

describe("formatDocumentYaml", () => {
  it("prints a one-line component as an indented block", () => {
    const raw = `version: 1
name: Posts
members: [ { label: Post, stock: 6x6x8 }, { label: Post, stock: 6x6x8 } ]
components: [ { label: Build, position: [0, 0, 0], rotation: [0, 0, 0], members: [ { id: post-1, position: [0, 0, 0], rotation: [0, 0, 0] }, { id: post-2, position: [10, 0, 0], rotation: [0, 0, 0] } ], connections: [ { members: [ { id: post-1 }, { id: post-2 } ], fasteners: [ { kind: none } ] } ] } ]
`;
    const next = formatDocumentYaml(raw);
    expect(next).not.toMatch(/^components:\s*\[/m);
    expect(next).toMatch(/components:\n {2}- label: Build/);
    expect(next).toMatch(/id: post-1\n\s+position: \[\s*0,\s*0,\s*0\s*\]/);
    expect(next).toMatch(/id: post-2\n\s+position: \[\s*10,\s*0,\s*0\s*\]/);
    expect(next).toMatch(/\{\s*id: post-1\s*\}/);
    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.components[0].members.map((member) => member.id)).toEqual(["post-1", "post-2"]);
    expect(formatDocumentYaml(next)).toBe(next);
  });

  it("leaves invalid YAML unchanged", () => {
    expect(formatDocumentYaml("components: [")).toBe("components: [");
  });

  it("keeps a leading comment", () => {
    const raw = `# keep me\nversion: 1\nname: Box\nmembers: []\ncomponents: []\n`;
    expect(formatDocumentYaml(raw)).toContain("# keep me");
  });
});
