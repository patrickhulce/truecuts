import { describe, expect, it } from "vitest";
import { Group, Mesh } from "three";
import { DIAGONAL_DIRECTIONS, GIZMO_HANDLE, prioritizeGizmoHits, snapDiagonalPosition } from "./gizmo-interaction";

describe("gizmo hit priority", () => {
  it("puts obscured handles before members without changing distance order within layers", () => {
    const board = { object: new Mesh(), distance: 1 };
    const arrow = { object: new Mesh(), distance: 10 };
    arrow.object.userData = GIZMO_HANDLE;
    const ring = { object: new Mesh(), distance: 12 };
    const parent = new Group(); parent.userData = GIZMO_HANDLE; parent.add(ring.object);
    const hits = [board, arrow, ring];
    expect(prioritizeGizmoHits(hits)).toEqual([arrow, ring, board]);
    expect(hits).toEqual([board, arrow, ring]);
  });
  it("leaves ordinary member hit order unchanged", () => {
    const hits = [{ object: new Mesh() }, { object: new Mesh() }];
    expect(prioritizeGizmoHits(hits)).toEqual(hits);
  });
});

describe("45 degree handles", () => {
  it.each(DIAGONAL_DIRECTIONS)("snaps both components of %j together", (...direction) => {
    const start: [number, number, number] = [10, 20, 30];
    const raw = start.map((n, i) => n + direction[i] * 3.3) as typeof start;
    expect(snapDiagonalPosition(start, raw, direction, 1)).toEqual(start.map((n, i) => n + direction[i] * 3));
    expect(snapDiagonalPosition(start, raw, direction, 0.125)).toEqual(start.map((n, i) => n + direction[i] * 3.25));
    const negative = start.map((n, i) => n - direction[i] * 2.2) as typeof start;
    expect(snapDiagonalPosition(start, negative, direction, 1)).toEqual(start.map((n, i) => n - direction[i] * 2));
  });
});
