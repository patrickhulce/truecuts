import { describe, expect, it } from "vitest";
import { assignIds, deriveId, IdentityError, isValidId, kebab } from "./identity";

describe("kebab", () => {
  it("lower-kebabs labels", () => {
    expect(kebab("Leg")).toBe("leg");
    expect(kebab("Cabinet Door")).toBe("cabinet-door");
    expect(kebab("2x4 Post")).toBe("2x4-post");
    expect(kebab("  Hello---World  ")).toBe("hello-world");
  });

  it("falls back when nothing alphanumeric remains", () => {
    expect(kebab("!!!")).toBe("item");
  });
});

describe("deriveId", () => {
  it("appends a 1-based index", () => {
    expect(deriveId("Leg", 1)).toBe("leg-1");
    expect(deriveId("Cabinet Door", 2)).toBe("cabinet-door-2");
  });
});

describe("isValidId", () => {
  it("requires kebab + numeric suffix", () => {
    expect(isValidId("leg-1")).toBe(true);
    expect(isValidId("cabinet-door-12")).toBe(true);
    expect(isValidId("leg")).toBe(false);
    expect(isValidId("Leg-1")).toBe(false);
    expect(isValidId("leg_1")).toBe(false);
  });
});

describe("assignIds", () => {
  it("derives ids grouped by kebab(label) in document order", () => {
    const result = assignIds([{ label: "Leg" }, { label: "Leg" }, { label: "Rail" }]);
    expect(result.map((item) => item.id)).toEqual(["leg-1", "leg-2", "rail-1"]);
  });

  it("is stable when labels are unchanged", () => {
    const first = assignIds([{ label: "Top" }, { label: "Leg" }, { label: "Leg" }]);
    const second = assignIds([{ label: "Top" }, { label: "Leg" }, { label: "Leg" }]);
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first.map((item) => item.id)).toEqual(["top-1", "leg-1", "leg-2"]);
  });

  it("keeps explicit ids and skips taken indexes", () => {
    const result = assignIds([
      { label: "Leg", id: "leg-2" },
      { label: "Leg" },
      { label: "Top", id: "top-1" },
    ]);
    expect(result.map((item) => item.id)).toEqual(["leg-2", "leg-1", "top-1"]);
  });

  it("rejects duplicate and malformed explicit ids", () => {
    expect(() => assignIds([{ label: "A", id: "leg-1" }, { label: "B", id: "leg-1" }])).toThrow(
      IdentityError,
    );
    expect(() => assignIds([{ label: "A", id: "Leg" }])).toThrow(IdentityError);
  });
});
