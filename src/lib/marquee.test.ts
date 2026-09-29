import { describe, expect, it } from "vitest";
import type { Vec3 } from "./geometry";
import { aabbCorners, projectedBoxHitsRect, type ScreenPoint, type ScreenRect } from "./marquee";

const box = { min: [0, 0, 0] as Vec3, max: [10, 2, 4] as Vec3 };

function identity(point: Vec3): ScreenPoint {
  return { x: point[0], y: point[2] };
}

describe("aabbCorners", () => {
  it("shifts every corner by the explode offset", () => {
    const corners = aabbCorners(box, [1, 2, 3]);
    expect(corners).toHaveLength(8);
    expect(corners).toContainEqual([1, 2, 3]);
    expect(corners).toContainEqual([11, 4, 7]);
  });
});

describe("projectedBoxHitsRect", () => {
  const rect: ScreenRect = { x0: 8, y0: 3, x1: 12, y1: 6 };

  it("hits when the projected box sits inside the rectangle", () => {
    expect(projectedBoxHitsRect(aabbCorners(box, [0, 0, 0]), identity, { x0: -1, y0: -1, x1: 20, y1: 20 })).toBe(true);
  });

  it("misses when the projected box is outside the rectangle", () => {
    expect(projectedBoxHitsRect(aabbCorners(box, [0, 0, 0]), identity, { x0: 30, y0: 30, x1: 40, y1: 40 })).toBe(false);
  });

  it("hits a partial overlap", () => {
    expect(projectedBoxHitsRect(aabbCorners(box, [0, 0, 0]), identity, rect)).toBe(true);
  });

  it("drops a corner behind the camera", () => {
    const project = (point: Vec3): ScreenPoint | null => (point[0] === 0 ? null : { x: 100, y: 100 });
    const corners: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
    ];
    expect(projectedBoxHitsRect(corners, project, { x0: 0, y0: 0, x1: 10, y1: 10 })).toBe(false);
  });
});
