import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import { parseDimension } from "./units";
import { sceneMembers } from "./scene";
import { selectionPosition, setSelectionPosition } from "./selection-position";

const BUILD = `version: 2
name: Position selection
members:
  - { label: Board, stock: 2x4x8 }
components:
  - label: Pair
    members:
      - { id: board-1, position: [2, 0, 0] }
      - { id: board-1, position: [2, 0, 10] }
    connections:
      - members: [{ id: board-1 }, { id: board-1, index: 1 }]
        fasteners: [{ kind: none }]
  - label: Group
    position: [20, 3, 30]
    rotation: [0, 90, 0]
    components:
      - { component: pair-1, position: [5, 0, 2] }
      - { component: pair-1, position: [5, 0, 20] }
  - label: Spare
    position: [200, 0, 0]
    members: [{ id: board-1 }]
`;

function compile(text: string) {
  const result = compileDocument(text);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return result.scene!;
}

describe("selection positioning", () => {
  it("moves a whole rotated group without changing its local contents or connections", () => {
    const scene = compile(BUILD);
    const keys = ["component:group-1"];
    const original = selectionPosition(scene, keys)!;
    const target = parseDimension(`5' - 1.5"`);
    const next = compile(setSelectionPosition(BUILD, scene, keys, 0, target));
    expect(selectionPosition(next, keys)).toEqual([target, original[1], original[2]]);
    expect(next.components[0].rotation).toEqual(scene.components[0].rotation);
    expect(next.components[0].children.map((child) => child.position)).toEqual(scene.components[0].children.map((child) => child.position));
    expect(next.connections).toEqual(scene.connections);
    expect(next.components[1]).toEqual(scene.components[1]);
  });

  it("translates members in differently rotated components by the same world delta", () => {
    const scene = compile(BUILD);
    const keys = ["group-1/pair-1#0/board-1#0", "spare-1/board-1#0"];
    const original = selectionPosition(scene, keys)!;
    const next = compile(setSelectionPosition(BUILD, scene, keys, 2, original[2] + 12));
    for (const key of keys) {
      const before = sceneMembers(scene.components).find((member) => member.key === key)!;
      const after = sceneMembers(next.components).find((member) => member.key === key)!;
      expect(after.worldCenter[0]).toBeCloseTo(before.worldCenter[0]);
      expect(after.worldCenter[1]).toBeCloseTo(before.worldCenter[1]);
      expect(after.worldCenter[2]).toBeCloseTo(before.worldCenter[2] + 12);
      expect(after.rotation).toEqual(before.rotation);
    }
  });

  it("does not move children twice when an ancestor and descendants are selected", () => {
    const scene = compile(BUILD);
    const parent = ["component:group-1"];
    const overlapping = [...parent, "component:group-1/pair-1#0", "group-1/pair-1#0/board-1#0"];
    const expected = setSelectionPosition(BUILD, scene, parent, 1, -5);
    expect(setSelectionPosition(BUILD, scene, overlapping, 1, -5)).toBe(expected);
  });

  it("positions multiple components while leaving their shared member definitions intact", () => {
    const scene = compile(BUILD);
    const keys = ["component:group-1/pair-1#0", "component:group-1/pair-1#1"];
    const original = selectionPosition(scene, keys)!;
    const next = compile(setSelectionPosition(BUILD, scene, keys, 0, original[0] + 8));
    expect(selectionPosition(next, keys)![0]).toBeCloseTo(original[0] + 8);
    expect(next.components[0].children[1].position[2] - next.components[0].children[0].position[2]).toBe(18);
    expect(next.components[0].children[0].members).toMatchObject(scene.components[0].children[0].members.map((member) => ({ position: member.position })));
  });

  it("uses the isolated editing frame for both the displayed corner and translation", () => {
    const scene = compile(BUILD);
    const keys = ["component:group-1/pair-1#0"];
    expect(selectionPosition(scene, keys, "group-1")).toEqual([7, 0, 2]);
    const next = compile(setSelectionPosition(BUILD, scene, keys, 0, -10, "group-1"));
    expect(selectionPosition(next, keys, "group-1")).toEqual([-10, 0, 2]);
    expect(next.components[0].children[1]).toEqual(scene.components[0].children[1]);
  });

  it("updates a shared placement only once when both occurrences are selected", () => {
    const scene = compile(BUILD);
    const keys = ["group-1/pair-1#0/board-1#0", "group-1/pair-1#1/board-1#0"];
    const original = selectionPosition(scene, keys)!;
    const next = compile(setSelectionPosition(BUILD, scene, keys, 1, 7));
    expect(selectionPosition(next, keys)).toEqual([original[0], 7, original[2]]);
  });

  it("reports incompatible linked rotations instead of changing relative spacing", () => {
    const text = BUILD.replace("position: [5, 0, 20]", "position: [5, 0, 20], rotation: [0, 90, 0]");
    const scene = compile(text);
    const keys = ["group-1/pair-1#0/board-1#0", "group-1/pair-1#1/board-1#0"];
    expect(() => setSelectionPosition(text, scene, keys, 0, 100)).toThrow(/Unlink/);
  });

  it("handles empty selections, unchanged coordinates, and invalid values", () => {
    const scene = compile(BUILD);
    expect(selectionPosition(scene, [])).toBeNull();
    const keys = ["component:group-1"];
    expect(setSelectionPosition(BUILD, scene, keys, 0, selectionPosition(scene, keys)![0])).toBe(BUILD);
    expect(() => setSelectionPosition(BUILD, scene, keys, 0, Infinity)).toThrow(/finite/);
  });

  it("rejects mixed selections where a shared member edit would also move inside a selected component", () => {
    const scene = compile(BUILD);
    const keys = ["component:group-1/pair-1#0", "group-1/pair-1#1/board-1#0"];
    expect(() => setSelectionPosition(BUILD, scene, keys, 1, 12)).toThrow(/Unlink/);
  });
});
