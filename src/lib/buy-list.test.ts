import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildBuyList, type BuyList } from "./buy-list";
import { compileDocument } from "./compile";
import { SAMPLE_BUILDS } from "./samples";
import { sceneMembers } from "./scene";
import { getCatalogPart } from "./catalog";

function makeBuild(parts: Array<{ stock?: string; length: number; width?: number }>) {
  const result = compileDocument(stringify({
    version: 2, name: "Buy list",
    members: parts.map((part, index) => ({
      id: `part-${index + 1}`, label: `Part ${index + 1}`, stock: part.stock ?? "2x4x10",
      cuts: [{ axis: 0, angle: 90, at: part.length }, ...(part.width === undefined ? [] : [{ axis: 1, angle: 90, at: part.width }])],
    })),
    components: [{ label: "Build", position: [0, 0, 0], members: parts.map((_, index) => ({ id: `part-${index + 1}` })) }],
  }));
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return result;
}

function checkLayout(plan: BuyList, kerf = 0) {
  const keys = plan.stock.flatMap((bin) => bin.cuts.map((cut) => cut.key));
  expect(new Set(keys).size).toBe(keys.length);
  for (const bin of plan.stock) {
    for (const [index, cut] of bin.cuts.entries()) {
      expect(cut.x).toBeGreaterThanOrEqual(0);
      expect(cut.y).toBeGreaterThanOrEqual(0);
      expect(cut.x + cut.length).toBeLessThanOrEqual(bin.stock.size[0] + 1e-6);
      expect(cut.y + cut.width).toBeLessThanOrEqual(bin.stock.size[1] + 1e-6);
      for (const other of bin.cuts.slice(index + 1)) {
        expect(cut.x + cut.length + kerf <= other.x + 1e-6 || other.x + other.length + kerf <= cut.x + 1e-6 ||
          cut.y + cut.width + kerf <= other.y + 1e-6 || other.y + other.width + kerf <= cut.y + 1e-6).toBe(true);
      }
    }
  }
}

describe("buy list", () => {
  it("buys one 8ft 2x4 for eight 1ft pieces", () => {
    const { scene } = makeBuild(Array.from({ length: 8 }, () => ({ length: 12 })));
    const plan = buildBuyList(scene!);
    expect(plan.stock).toHaveLength(1);
    expect(plan.stock[0].stock.id).toBe("2x4x8");
    expect(plan.stock[0].cuts).toHaveLength(8);
    checkLayout(plan);
  });

  it("chooses a 10ft board when saw kerf prevents eight 1ft cuts fitting on 8ft", () => {
    const { scene } = makeBuild(Array.from({ length: 8 }, () => ({ length: 12 })));
    const plan = buildBuyList(scene!, 0.125);
    expect(plan.stock.map((bin) => bin.stock.id)).toEqual(["2x4x10"]);
    checkLayout(plan, 0.125);
  });

  it("combines compatible source stocks and considers longer boards", () => {
    const { scene } = makeBuild([{ length: 60, stock: "2x4x8" }, { length: 60, stock: "2x4x10" }]);
    const plan = buildBuyList(scene!);
    expect(plan.stock.map((bin) => bin.stock.id)).toEqual(["2x4x10"]);
    checkLayout(plan);
  });

  it("packs mixed cuts into offcuts and keeps lumber widths separate", () => {
    const { scene } = makeBuild([{ length: 72 }, { length: 72 }, { length: 24 }, { length: 24 }, { length: 12, stock: "2x12x8" }]);
    const plan = buildBuyList(scene!);
    expect(plan.stock.map((bin) => bin.stock.id)).toEqual(["2x4x8", "2x4x8", "2x12x8"]);
    expect(plan.stock.flatMap((bin) => bin.cuts)).toHaveLength(5);
    checkLayout(plan);
  });

  it("packs four 4ft by 2ft plywood panels into one 4x8 sheet", () => {
    const { scene } = makeBuild(Array.from({ length: 4 }, () => ({ stock: "plywood-3/4-4x8", length: 48, width: 24 })));
    const plan = buildBuyList(scene!);
    expect(plan.stock).toHaveLength(1);
    expect(plan.stock[0].cuts).toHaveLength(4);
    checkLayout(plan);
    const withKerf = buildBuyList(scene!, 0.125);
    // Two exact half-lengths/half-widths no longer fit once kerf is included.
    // Grain direction is preserved, so these pieces are not rotated to fit.
    expect(withKerf.stock).toHaveLength(4);
    checkLayout(withKerf, 0.125);
  });

  it("keeps sheet material and thickness separate", () => {
    const { scene } = makeBuild(["plywood-3/4-4x8", "plywood-1/2-4x8", "osb-7/16-4x8", "hardboard-1/8-4x8"].map((stock) => ({ stock, length: 12, width: 12 })));
    const plan = buildBuyList(scene!);
    expect(plan.stock).toHaveLength(4);
    checkLayout(plan);
  });

  it("counts every nested occurrence, ignores unused definitions, and combines painted parts", () => {
    const result = compileDocument(stringify({ version: 2, name: "Copies",
      members: [{ label: "Panel", stock: "hardboard-1/8-4x8", paint: "#ffffff", cuts: [{ axis: 0, angle: 90, at: 12 }] }, { label: "Unused", stock: "2x4x8" }],
      components: [{ label: "Unit", members: [{ id: "panel-1" }] }, { label: "Build", position: [0, 0, 0], components: [{ component: "unit-1" }, { component: "unit-1" }] }],
    }));
    expect(result.scene).toBeDefined();
    const plan = buildBuyList(result.scene!);
    expect(plan.pieceCount).toBe(2);
    expect(plan.stock).toHaveLength(1);
    expect(plan.stock[0].cuts).toHaveLength(2);
    checkLayout(plan);
  });

  it("handles an empty build and rejects invalid kerf", () => {
    const { scene } = makeBuild([]);
    expect(buildBuyList(scene!)).toEqual({ stock: [], items: [], consumables: [], unpacked: [], pieceCount: 0 });
    expect(() => buildBuyList(scene!, -1)).toThrow();
    expect(() => buildBuyList(scene!, Infinity)).toThrow();
  });

  it.each(SAMPLE_BUILDS)("accounts for all placed parts in $label", (sample) => {
    const compiled = compileDocument(sample.yaml);
    const plan = buildBuyList(compiled.scene!, 0.125, compiled.document);
    expect(plan.unpacked).toEqual([]);
    expect(plan.pieceCount).toBe(sceneMembers(compiled.scene!.components).length);
    const directMembers = sceneMembers(compiled.scene!.components).filter((member) => {
      const stock = getCatalogPart(member.stockId)!;
      return stock.axes || (stock.kind !== "lumber" && stock.kind !== "sheet");
    });
    expect(plan.stock.flatMap((bin) => bin.cuts)).toHaveLength(plan.pieceCount - directMembers.length);
    expect(plan.items.reduce((sum, item) => sum + item.count, 0)).toBe(
      directMembers.length + compiled.scene!.fasteners.filter((fastener) => fastener.subtype !== "glue").length,
    );
    checkLayout(plan, 0.125);
  });
});
