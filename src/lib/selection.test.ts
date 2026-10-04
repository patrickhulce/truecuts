import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, pruneSelection, selectAdded, selectAll, selectKeys, selectMember, type Selection } from "./selection";

const multi = (keys: string[]): Selection => ({ keys, mode: "multi" });

describe("selectMember", () => {
  it("replaces the selection on a plain click", () => {
    expect(selectMember(multi(["a", "b"]), "c", false)).toEqual({ keys: ["c"], mode: "single" });
  });

  it("adds a member on shift-click and keeps the one already selected", () => {
    expect(selectMember({ keys: ["a"], mode: "single" }, "b", true)).toEqual(multi(["a", "b"]));
  });

  it("removes a member that is shift-clicked again", () => {
    expect(selectMember(multi(["a", "b"]), "a", true)).toEqual(multi(["b"]));
  });
});

describe("selectAdded", () => {
  it("appends members that are not already selected", () => {
    expect(selectAdded({ keys: ["a"], mode: "single" }, ["b", "c"])).toEqual(multi(["a", "b", "c"]));
  });

  it("keeps the current selection when every hit is already selected", () => {
    const current = multi(["a", "b"]);
    expect(selectAdded(current, ["b", "a"])).toBe(current);
  });

  it("returns the same selection for an empty hit list", () => {
    const current = { keys: ["a"], mode: "single" as const };
    expect(selectAdded(current, [])).toBe(current);
    expect(selectAdded(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION);
  });

  it("stays in single mode when the only member is new", () => {
    expect(selectAdded(EMPTY_SELECTION, ["a"])).toEqual({ keys: ["a"], mode: "single" });
  });
});

describe("selectKeys", () => {
  it("returns the same selection for an empty list", () => {
    const current = multi(["a", "b"]);
    expect(selectKeys(current, [])).toBe(current);
    expect(selectKeys(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION);
  });

  it("uses single mode for one member", () => {
    expect(selectKeys(multi(["a", "b"]), ["c"])).toEqual({ keys: ["c"], mode: "single" });
  });

  it("uses multi mode for several members", () => {
    expect(selectKeys({ keys: ["a"], mode: "single" }, ["b", "c"])).toEqual(multi(["b", "c"]));
  });

  it("keeps an explicit multi mode for a single member", () => {
    expect(selectKeys({ keys: ["a"], mode: "single" }, ["b"], "multi")).toEqual(multi(["b"]));
  });

  it("returns the same selection when those members are already selected", () => {
    const current = multi(["a", "b"]);
    expect(selectKeys(current, ["a", "b"])).toBe(current);
  });
});

describe("selectAll", () => {
  it("selects every member and uses single mode for one", () => {
    expect(selectAll([])).toEqual(EMPTY_SELECTION);
    expect(selectAll(["a"])).toEqual({ keys: ["a"], mode: "single" });
    expect(selectAll(["a", "b", "c"])).toEqual(multi(["a", "b", "c"]));
  });
});

describe("pruneSelection", () => {
  it("returns the same selection when every key is still live", () => {
    const current = multi(["a", "b"]);
    expect(pruneSelection(current, new Set(["a", "b", "c"]))).toBe(current);
  });

  it("drops missing keys and clears an empty result", () => {
    expect(pruneSelection(multi(["a", "gone"]), new Set(["a"]))).toEqual(multi(["a"]));
    expect(pruneSelection({ keys: ["gone"], mode: "single" }, new Set())).toEqual(EMPTY_SELECTION);
  });
});
