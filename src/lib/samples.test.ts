import { describe, expect, it } from "vitest";
import { getCatalogPart } from "./catalog";
import { STOCK_FAMILIES } from "./catalog-families";
import { compileDocument } from "./compile";
import { SAMPLE_BUILDS } from "./samples";

describe("sample builds", () => {
  it.each(SAMPLE_BUILDS.map((sample) => [sample.name, sample.yaml] as const))(
    "%s compiles without errors",
    (_name, yaml) => {
      const result = compileDocument(yaml);
      expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
      expect(result.scene).toBeDefined();
    },
  );
});

describe("stock families", () => {
  it("points every variant at a catalog part", () => {
    for (const family of STOCK_FAMILIES) {
      expect(family.variants.length).toBeGreaterThan(0);
      for (const id of family.variants) {
        expect(getCatalogPart(id), `${family.id} → ${id}`).toBeDefined();
      }
    }
  });

  it("includes round rod stock sizes up to 4' (48\")", () => {
    const rodFamily = STOCK_FAMILIES.find((family) => family.id === "rod");
    expect(rodFamily).toBeDefined();
    expect(rodFamily?.variants).toEqual([
      "rod-1x12",
      "rod-1x16",
      "rod-1x21",
      "rod-1x24",
      "rod-1x30",
      "rod-1x36",
      "rod-1x48",
    ]);

    const part4ft = getCatalogPart("rod-1x48");
    expect(part4ft).toBeDefined();
    expect(part4ft?.size).toEqual([48, 1, 1]);

    const part2_5ft = getCatalogPart("rod-1x30");
    expect(part2_5ft).toBeDefined();
    expect(part2_5ft?.size).toEqual([30, 1, 1]);

    const part3ft = getCatalogPart("rod-1x36");
    expect(part3ft).toBeDefined();
    expect(part3ft?.size).toEqual([36, 1, 1]);
  });
});
