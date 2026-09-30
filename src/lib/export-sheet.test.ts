import { describe, expect, it } from "vitest";
import { exportSheetFilename, layoutSheet, overallDimensions, type SheetRect } from "./export-sheet";
import type { Aabb } from "./geometry";

function overlaps(a: SheetRect, b: SheetRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function bottom(rect: SheetRect): number {
  return rect.y + rect.height;
}

describe("layoutSheet", () => {
  it("puts a borderless hero on the left and stacks the rest on the right", () => {
    const layout = layoutSheet(5);
    expect(layout.width).toBe(2400);
    expect(layout.cells).toHaveLength(5);
    const [hero, first, second, third, fourth] = layout.cells;
    expect(hero!.framed).toBe(false);
    expect(layout.cells.slice(1).every((cell) => cell.framed)).toBe(true);
    expect(hero!.image.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height);
    expect(hero!.image.x).toBeLessThan(first!.image.x);
    expect(hero!.image.width).toBeGreaterThan(first!.image.width);
    expect(hero!.image.height).toBeGreaterThan(first!.image.height);
    expect(first!.image.x).toBe(second!.image.x);
    expect(first!.image.width).toBe(second!.image.width);
    expect(second!.image.y).toBeGreaterThan(first!.image.y);
    expect(third!.image.x).toBe(first!.image.x);
    expect(third!.image.y).toBe(fourth!.image.y);
    expect(third!.image.y).toBeGreaterThan(second!.image.y);
    expect(fourth!.image.x).toBeGreaterThan(third!.image.x);
    expect(bottom(hero!.label)).toBeCloseTo(bottom(fourth!.label), 5);

    const rects = layout.cells.flatMap((cell) => [cell.image, cell.label]);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
      }
    }
    for (const cell of layout.cells) {
      expect(cell.label.y).toBeGreaterThanOrEqual(cell.image.y + cell.image.height - 1e-6);
    }
  });

  it("stacks two extras and pairs the tail once a third extra appears", () => {
    const two = layoutSheet(3);
    expect(two.cells[1]!.image.x).toBe(two.cells[2]!.image.x);
    expect(two.cells[2]!.image.y).toBeGreaterThan(two.cells[1]!.image.y);

    const three = layoutSheet(4);
    expect(three.cells[2]!.image.y).toBe(three.cells[3]!.image.y);
    expect(three.cells[2]!.image.x).toBe(three.cells[1]!.image.x);
    expect(three.cells[3]!.image.x).toBeGreaterThan(three.cells[2]!.image.x);
  });

  it("keeps a single hero and an empty header", () => {
    const alone = layoutSheet(1);
    expect(alone.cells).toHaveLength(1);
    expect(alone.cells[0]!.framed).toBe(false);
    expect(alone.cells[0]!.image.width).toBe(alone.header.width);
    expect(layoutSheet(0).cells).toHaveLength(0);
    expect(layoutSheet(0).height).toBeGreaterThan(layoutSheet(0).header.height);
  });
});

describe("overallDimensions", () => {
  it("prints the world span longest to shortest as L × W × H", () => {
    const bounds: Aabb = { min: [0, 0, 0], max: [96, 3.5, 1.5] };
    expect(overallDimensions(bounds)).toBe('L 8\' × W 3 1/2" × H 1 1/2"');
    const tall: Aabb = { min: [0, 0, 0], max: [10, 48, 24] };
    expect(overallDimensions(tall)).toBe('L 4\' × W 2\' × H 10"');
  });
});

describe("exportSheetFilename", () => {
  it("slugs the build name", () => {
    expect(exportSheetFilename("Assembly Bench")).toBe("assembly-bench-sheet.png");
    expect(exportSheetFilename("")).toBe("build-sheet.png");
  });
});
