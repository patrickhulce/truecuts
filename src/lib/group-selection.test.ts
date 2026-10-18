import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { compileDocument } from "./compile";
import { groupFromSelection } from "./group-selection";
import { sceneMembers, walkSceneComponents, type SceneModel } from "./scene";
import { applyPose, type Vec3 } from "./geometry";

// The affected area of the reported build, including the hidden definition and
// its rotated root occurrence. The other boards do not affect grouping.
const source = `version: 2
name: Grouping regression
members:
  - { id: board-14, label: Board, stock: 2x4x8, cuts: [{ axis: 0, angle: 90, at: 20.5 }] }
  - { id: board-15, label: Board, stock: 2x4x8, cuts: [{ axis: 0, angle: 90, at: 20.5 }] }
  - { id: board-19, label: Board, stock: 2x4x8, cuts: [{ axis: 0, angle: 90, at: 17 }] }
  - { id: board-20, label: Board, stock: 2x4x8, cuts: [{ axis: 0, angle: 90, at: 17 }] }
  - { id: board-24, label: Board, stock: 2x4x8, cuts: [{ axis: 0, angle: 90, at: 24.25 }] }
  - { id: board-21, label: Board, stock: 2x4x8, cuts: [{ axis: 0, angle: 90, at: 24.25 }] }
components:
  - id: group-1
    label: Group
    position: [0, 0, -12]
    rotation: [0, 0, 0]
    members:
      - { id: board-14, position: [-32.5, 0, 0], rotation: [0, 0, 0] }
      - { id: board-15, position: [-32.5, 9.5, 0], rotation: [0, 0, 0] }
  - id: group-2
    label: Group
    position: [-12, 0, -8.5]
    rotation: [180, -90, 180]
    members:
      - { id: board-19, position: [0, 0, 0], rotation: [0, 0, 0] }
      - { id: board-20, position: [0, 9.5, 0], rotation: [0, 0, 0] }
  - id: group-4
    label: Group
    rotation: [180, -90, 180]
    members:
      - { id: board-24, position: [-5.7309, 0, -4.2101], rotation: [0, 0, 0] }
      - { id: board-21, position: [-6, 9.5, -4], rotation: [0, 0, 0] }
  - id: group-3
    component: group-4
    position: [-29, 0, -4]
    rotation: [0, -45, 0]
`;

function worldVertices(scene: SceneModel) {
  const points = new Map<string, Vec3[]>();
  walkSceneComponents(scene.components, component => {
    for (const part of component.members) points.set(part.memberId, part.faces.flat().map(point =>
      applyPose(applyPose(point, part.position, part.rotation), component.worldPosition, component.worldRotation),
    ));
  });
  return points;
}

const nested = source.replace("    component: group-4", "    label: Group\n    components:\n      - { component: group-4 }");
const withChildren = parse(source);
withChildren.components[1].components = [{ component: "group-4", position: [-17, 0, 4.5], rotation: [0, -45, 0] }];
withChildren.components.pop();

describe("grouping boards from referenced components", () => {
  it.each([
    { name: "some boards from a root reference", yaml: source, ids: ["board-15", "board-20", "board-21"] },
    { name: "all boards from a root reference plus other boards", yaml: source, ids: ["board-15", "board-20", "board-21", "board-24"] },
    { name: "only the entire rotated root reference", yaml: source, ids: ["board-21", "board-24"] },
    { name: "all boards from a nested reference", yaml: nested, ids: ["board-21", "board-24"] },
    { name: "a component whose nested children stay behind", yaml: stringify(withChildren), ids: ["board-19", "board-20"] },
  ])("preserves valid YAML and world vertices: $name", ({ yaml, ids }) => {
    const before = compileDocument(yaml);
    expect(before.diagnostics).toEqual([]);
    const members = sceneMembers(before.scene!.components);
    const keys = members.filter(part => ids.includes(part.memberId)).map(part => part.key);
    const grouped = groupFromSelection(yaml, before.scene!, keys)!;
    const after = compileDocument(grouped.text);
    expect(after.diagnostics).toEqual([]);
    const remaining = sceneMembers(after.scene!.components);
    expect(remaining).toHaveLength(members.length);
    const verticesBefore = worldVertices(before.scene!);
    const verticesAfter = worldVertices(after.scene!);
    for (const original of members) {
      const next = remaining.find(part => part.memberId === original.memberId)!;
      for (const corner of ["min", "max"] as const) {
        original.worldBounds[corner].forEach((value, axis) => expect(next.worldBounds[corner][axis]).toBeCloseTo(value, 3));
      }
      verticesBefore.get(original.memberId)!.forEach((point, index) => {
        point.forEach((value, axis) => expect(verticesAfter.get(original.memberId)![index][axis]).toBeCloseTo(value, 3));
      });
    }
  });
});
