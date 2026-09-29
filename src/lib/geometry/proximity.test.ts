import { describe, expect, it } from "vitest";
import { compileDocument } from "../compile";
import { patchNeighbor, patchesFor } from "./contact";
import { applyPose, rotateEulerXYZ } from "./pose";
import {
  boundarySnapDelta,
  groupOrigin,
  nearInstanceKeys,
  originCorner,
  placementAfterReseat,
  placementInNewGroup,
  positionAlongAxis,
  positionForOriginCorner,
  snapResizeFace,
  unionAabb,
  worldPlacementPose,
  type Aabb,
} from "./proximity";
import type { Vec3 } from "./types";

const BEAM_YAML = `version: 1
name: Untitled
members:
  - { label: Post, stock: 6x6x8 }
  - { label: Post, stock: 6x6x8 }
  - { label: Post, stock: 6x6x8, cuts: [{ axis: 0, angle: 90, at: 24 }] }
components:
  - label: Build
    position: [0, 0, 0]
    rotation: [0, 0, 0]
    members:
      - { id: post-1, position: [42, 0, 51], rotation: [0, 0, 90] }
      - { id: post-2, position: [71.375, 0, 51], rotation: [0, 0, 90] }
      - { id: post-3, position: [42, 60, 51], rotation: [0, 0, 0] }
    connections:
      - members:
          - { id: post-3 }
          - { id: post-1 }
        fasteners:
          - { kind: connector, stock: connector-t }
`;

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Aabb {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

describe("unionAabb", () => {
  it("encloses every box", () => {
    expect(unionAabb([box(0, 1, 2, 3, 4, 5), box(-2, 0, 8, 1, 9, 10)])).toEqual({
      min: [-2, 0, 2],
      max: [3, 9, 10],
    });
  });

  it("returns null for no boxes", () => {
    expect(unionAabb([])).toBeNull();
  });
});

describe("overlapping beam and post", () => {
  it("keeps a contact only with the flush post and lists the penetrating post as near", () => {
    const result = compileDocument(BEAM_YAML);
    expect(result.scene).toBeDefined();
    const members = result.scene!.components.flatMap((component) => component.members);
    const beam = members.find((member) => member.memberId === "post-3");
    const post1 = members.find((member) => member.memberId === "post-1");
    const post2 = members.find((member) => member.memberId === "post-2");
    expect(beam && post1 && post2).toBeTruthy();

    const contactNeighbors = patchesFor(result.scene!.contacts, beam!.key).map(
      (patch) => patchNeighbor(patch, beam!.key).instanceKey,
    );
    expect(contactNeighbors).toEqual([post1!.key]);

    const near = nearInstanceKeys(beam!.key, members);
    expect(near).toContain(post1!.key);
    expect(near).toContain(post2!.key);

    const delta = boundarySnapDelta(
      beam!.worldBounds,
      [post1!.worldBounds, post2!.worldBounds],
      0,
    );
    expect(delta).toBeNull();
  });
});

describe("originCorner", () => {
  const board = box(0, 0, 0, 30, 1.5, 3.5);

  it("is the placement pivot when the stock already grows away from the origin", () => {
    expect(originCorner(board, [10, 0, 4], [0, 0, 0])).toEqual([10, 0, 4]);
  });

  it("reports the bottom after a rotation that flips thickness downward", () => {
    const corner = originCorner(board, [10, 20, 5], [90, 0, 0]);
    expect(corner[0]).toBeCloseTo(10);
    expect(corner[1]).toBeCloseTo(16.5);
    expect(corner[2]).toBeCloseTo(5);
  });

  it("keeps Y on the bottom for a leg stood on end", () => {
    const corner = originCorner(board, [2, 0, 0], [90, 90, 0]);
    expect(corner[1]).toBe(0);
    expect(corner[0]).toBeGreaterThanOrEqual(0);
    expect(corner[2]).toBeGreaterThanOrEqual(0);
  });

  it("moves the pivot so the typed value lands on that corner", () => {
    const next = positionForOriginCorner(board, [10, 20, 5], [90, 0, 0], 1, 0);
    expect(next[0]).toBeCloseTo(10);
    expect(next[1]).toBeCloseTo(3.5);
    expect(next[2]).toBeCloseTo(5);
    expect(originCorner(board, next, [90, 0, 0])[1]).toBeCloseTo(0);
  });
});

describe("boundarySnapDelta", () => {
  const moving = box(0, 0, 0, 10, 2, 2);

  it("applies the only shift within reach", () => {
    expect(boundarySnapDelta(moving, [box(11.5, 0, 0, 14, 2, 2)], 0)).toBeCloseTo(1.5);
  });

  it("does not snap when two different shifts are within reach", () => {
    expect(
      boundarySnapDelta(moving, [box(11, 0, 0, 20, 2, 2), box(11.5, 0, 0, 20, 2, 2)], 0),
    ).toBeNull();
  });

  it("ignores a shift past 2 inches", () => {
    expect(boundarySnapDelta(moving, [box(12.5, 0, 0, 16, 2, 2)], 0)).toBeNull();
  });

  it("treats the same shift from two faces as one candidate", () => {
    expect(
      boundarySnapDelta(moving, [box(12, 0, 0, 14, 2, 2), box(12, 0, 0, 20, 2, 2)], 0),
    ).toBeCloseTo(2);
  });

  it("does not snap to a boundary that misses on the other axes", () => {
    expect(boundarySnapDelta(moving, [box(11, 5, 0, 14, 7, 2)], 0)).toBeNull();
  });

  it("does not move when the only boundary is already flush", () => {
    expect(boundarySnapDelta(moving, [box(10, 0, 0, 20, 2, 2)], 0)).toBeNull();
  });

  it("seats a sheet on the rail top instead of burying it", () => {
    const sheet = box(0, 95, 0, 35, 95.75, 96);
    const rail = box(0, 90, 0, 5.5, 95.5, 96);
    expect(boundarySnapDelta(sheet, [rail], 1)).toBeCloseTo(0.5);
  });
});

describe("positionAlongAxis", () => {
  const board = box(0, 0, 0, 10, 2, 2);
  const start: [number, number, number] = [10.25, 1.5, 3.5];

  it("snaps only the axis being moved", () => {
    expect(positionAlongAxis(start, 0, 12, board, [0, 0, 0], [], false)).toEqual([12, 1.5, 3.5]);
  });

  it("keeps the other axes when a boundary shifts the one being moved", () => {
    const neighbor = box(21.5, 0, 3.5, 24, 1.6, 5.5);
    const next = positionAlongAxis(start, 0, 10.25, board, [0, 0, 0], [neighbor], true);
    expect(next[0]).toBeCloseTo(11.5);
    expect(next[1]).toBe(1.5);
    expect(next[2]).toBe(3.5);
  });
});

describe("snapResizeFace", () => {
  const board = box(0, 0, 0, 10, 2, 2);
  const ahead = box(11.5, 0, 0, 14, 2, 2);
  const behind = box(-11.5, 0, 0, -1.5, 2, 2);

  it("seats only the dragged face and leaves an off-grid boundary", () => {
    expect(boundarySnapDelta(board, [ahead, behind], 0)).toBeNull();
    expect(snapResizeFace(board, [0, 0, 0], [0, 0, 0], 0, "end", 10, [ahead, behind], true)).toBeCloseTo(11.5);
    expect(snapResizeFace(board, [0, 0, 0], [0, 0, 0], 0, "end", 10, [behind], true)).toBe(10);
  });

  it("stays on the grid coordinate when boundary snap is off", () => {
    expect(snapResizeFace(board, [0, 0, 0], [0, 0, 0], 0, "end", 10, [ahead], false)).toBe(10);
  });
});

describe("group frame", () => {
  it("puts the origin on the minimum corner of the union", () => {
    expect(groupOrigin([box(4, 1, 2, 10, 3, 6), box(1, 0, 5, 3, 2, 8)])).toEqual([1, 0, 2]);
    expect(groupOrigin([])).toBeNull();
  });

  it("bakes a rotated parent into an unrotated group and reseats without moving the pivot", () => {
    const component = { position: [10, 0, 4] as Vec3, rotation: [0, 90, 0] as Vec3 };
    const placement = { position: [2, 0, 8] as Vec3, rotation: [90, 0, 0] as Vec3 };
    const world = worldPlacementPose(placement, component);
    const sequential = rotateEulerXYZ(rotateEulerXYZ([3, 1, 2], placement.rotation), component.rotation);
    const baked = rotateEulerXYZ([3, 1, 2], world.rotation);
    expect(baked[0]).toBeCloseTo(sequential[0], 5);
    expect(baked[1]).toBeCloseTo(sequential[1], 5);
    expect(baked[2]).toBeCloseTo(sequential[2], 5);

    const origin: Vec3 = [1, 0, 2];
    const grouped = placementInNewGroup(world, origin);
    const regrouped = applyPose(grouped.position, origin, [0, 0, 0]);
    expect(regrouped[0]).toBeCloseTo(world.position[0], 5);
    expect(regrouped[1]).toBeCloseTo(world.position[1], 5);
    expect(regrouped[2]).toBeCloseTo(world.position[2], 5);

    const reseated = placementAfterReseat(world.position, origin, component.rotation);
    const kept = applyPose(reseated, origin, component.rotation);
    expect(kept[0]).toBeCloseTo(world.position[0], 5);
    expect(kept[1]).toBeCloseTo(world.position[1], 5);
    expect(kept[2]).toBeCloseTo(world.position[2], 5);
  });
});
