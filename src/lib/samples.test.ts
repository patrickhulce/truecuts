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
});
