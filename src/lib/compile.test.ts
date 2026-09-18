import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import { DEMO_YAML } from "./demo";

describe("compileDocument", () => {
  it("compiles the demo YAML into a scene", () => {
    const result = compileDocument(DEMO_YAML);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.parts).toHaveLength(10);
    expect(result.document?.parts.map((part) => part.id)).toEqual([
      "leg-1",
      "leg-2",
      "leg-3",
      "leg-4",
      "long-apron-1",
      "long-apron-2",
      "short-apron-1",
      "short-apron-2",
      "brace-1",
      "top-1",
    ]);
    expect(result.scene?.components).toHaveLength(1);
    expect(result.scene?.components[0].parts).toHaveLength(10);
  });

  it("reports YAML parse errors with line numbers", () => {
    const result = compileDocument("version: [\n");
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].line).toBeDefined();
  });
});
