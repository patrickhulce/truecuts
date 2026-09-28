import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, pruneSelection, selectAll, selectMember, type Selection } from "./selection";

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
