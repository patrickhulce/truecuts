import { describe, expect, it } from "vitest";
import { compileDocument } from "../compile";
import { patchNeighbor, patchesFor } from "./contact";
import { boundarySnapDelta, nearInstanceKeys, originCorner, positionForOriginCorner, unionAabb, type Aabb } from "./proximity";

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
});
