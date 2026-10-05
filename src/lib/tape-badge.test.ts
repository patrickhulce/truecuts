import { describe, expect, it } from "vitest";
import {
  TAPE_BADGE_GAP_PX,
  tapeBadgeDirection,
  tapeBadgePlacement,
  tapeBadgeRect,
  tapeBadgeTransform,
  type ScreenRect,
} from "./tape-badge";

const PILL = { width: 160, height: 44 };

function gapAtOrigin(rect: ScreenRect): number {
  const dx = rect.left > 0 ? rect.left : rect.right < 0 ? rect.right : 0;
  const dy = rect.top > 0 ? rect.top : rect.bottom < 0 ? rect.bottom : 0;
  return Math.hypot(dx, dy);
}

describe("tapeBadgeDirection", () => {
  it("places a horizontal tape above the line", () => {
    const direction = tapeBadgeDirection({ x: 0, y: 100 }, { x: 200, y: 100 }, null);
    expect(direction.x).toBeCloseTo(0);
    expect(direction.y).toBeCloseTo(-1);
  });

  it("places a vertical tape to the side of the line", () => {
    const direction = tapeBadgeDirection({ x: 100, y: 0 }, { x: 100, y: 200 }, null);
    expect(Math.abs(direction.x)).toBeCloseTo(1);
    expect(direction.y).toBeCloseTo(0);
  });

  it("flips to the side away from a cursor that has left the end", () => {
    const start = { x: 0, y: 100 };
    const end = { x: 200, y: 100 };
    const above = tapeBadgeDirection(start, end, { x: 200, y: 20 });
    const below = tapeBadgeDirection(start, end, { x: 200, y: 180 });
    expect(above.y).toBeGreaterThan(0);
    expect(below.y).toBeLessThan(0);

    const verticalStart = { x: 100, y: 0 };
    const verticalEnd = { x: 100, y: 200 };
    const cursorOnRight = tapeBadgeDirection(verticalStart, verticalEnd, { x: 180, y: 200 });
    expect(cursorOnRight.x).toBeLessThan(0);
  });

  it("keeps a cursor sitting on the end from flipping the upward side", () => {
    const direction = tapeBadgeDirection({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 210, y: 108 });
    expect(direction.y).toBeCloseTo(-1);
  });

  it("uses up and to the right when the tape is only a few pixels long", () => {
    const direction = tapeBadgeDirection({ x: 10, y: 10 }, { x: 14, y: 12 }, { x: 40, y: 40 });
    expect(direction.x).toBeGreaterThan(0);
    expect(direction.y).toBeLessThan(0);
  });
});

describe("tapeBadgeTransform", () => {
  it("anchors the near edge a gap away from the endpoint", () => {
    expect(tapeBadgeTransform({ x: 0, y: -1 })).toBe("translate(-50%, calc(-100% - 36px))");
    expect(tapeBadgeTransform({ x: 1, y: 0 })).toBe("translate(36px, -50%)");
    expect(tapeBadgeTransform({ x: -1, y: 0 })).toBe("translate(calc(-100% - 36px), -50%)");
    expect(tapeBadgeTransform({ x: 0, y: 1 })).toBe("translate(-50%, 36px)");
    expect(tapeBadgeTransform({ x: 0.6, y: -0.8 })).toBe("translate(36px, calc(-100% - 36px))");
  });

  it("keeps a wide pill clear of the endpoint", () => {
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 0.6, y: -0.8 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
    ];
    for (const direction of directions) {
      const rect = tapeBadgeRect(direction, PILL);
      expect(gapAtOrigin(rect)).toBeGreaterThanOrEqual(TAPE_BADGE_GAP_PX - 1e-6);
    }
  });

  it("matches the upward horizontal placement to a 36px gap under the pill", () => {
    const { direction } = tapeBadgePlacement({ x: 0, y: 100 }, { x: 240, y: 100 }, null);
    expect(tapeBadgeRect(direction, { width: 80, height: 30 })).toEqual({
      left: -40,
      top: -66,
      right: 40,
      bottom: -36,
    });
  });
});
