import { describe, expect, it } from "vitest";
import { validateDocument } from "./schema";

const base = {
  version: 1 as const,
  name: "Test",
};

describe("validateDocument", () => {
  it("derives ids from labels", () => {
    const { document, issues } = validateDocument({
      ...base,
      parts: [
        { label: "Leg", stock: "2x4x8", cuts: [{ axis: 0, angle: 90, at: 34 }] },
        { label: "Leg", stock: "2x4x8" },
        { label: "Top", stock: "plywood-3/4-4x8" },
      ],
      components: [
        {
          label: "Horse",
          parts: [{ part: "leg-1", position: [0, 0, 0] }],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(document?.parts.map((part) => part.id)).toEqual(["leg-1", "leg-2", "top-1"]);
    expect(document?.components[0].id).toBe("horse-1");
  });

  it("keeps explicit ids that match the regex", () => {
    const { document, issues } = validateDocument({
      ...base,
      parts: [{ id: "top-1", label: "Top", stock: "plywood-3/4-4x8" }],
    });
    expect(issues).toEqual([]);
    expect(document?.parts[0].id).toBe("top-1");
  });

  it("rejects malformed ids", () => {
    const { document, issues } = validateDocument({
      ...base,
      parts: [{ id: "Top", label: "Top", stock: "2x4x8" }],
    });
    expect(document).toBeUndefined();
    expect(issues.some((issue) => issue.message.includes("Invalid id"))).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const { issues } = validateDocument({
      ...base,
      parts: [
        { id: "leg-1", label: "Leg", stock: "2x4x8" },
        { id: "leg-1", label: "Other", stock: "2x4x8" },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("Duplicate"))).toBe(true);
  });

  it("rejects unknown part references", () => {
    const { issues } = validateDocument({
      ...base,
      parts: [{ label: "Leg", stock: "2x4x8" }],
      components: [{ label: "Horse", parts: [{ part: "missing-1" }] }],
    });
    expect(issues.some((issue) => issue.message.includes("Unknown part"))).toBe(true);
  });

  it("requires a range iff the cut is not square", () => {
    const squareRange = validateDocument({
      ...base,
      parts: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 90, at: [1, 2] }] }],
    });
    expect(squareRange.issues.length).toBeGreaterThan(0);

    const angledSingle = validateDocument({
      ...base,
      parts: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 45, at: 10 }] }],
    });
    expect(angledSingle.issues.length).toBeGreaterThan(0);

    const angledRange = validateDocument({
      ...base,
      parts: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 45, at: [10, 14] }] }],
    });
    expect(angledRange.issues).toEqual([]);
    expect(angledRange.document?.parts[0].cuts[0].at).toEqual([10, 14]);
  });

  it("rejects short >= long", () => {
    const { issues } = validateDocument({
      ...base,
      parts: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 45, at: [10, 10] }] }],
    });
    expect(issues.some((issue) => issue.message.includes("short point"))).toBe(true);
  });
});
