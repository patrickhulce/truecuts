import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import {
  EMPTY_SELECTION,
  componentSelectionKey,
  hitSelectionKey,
  linkedCopyComponent,
  pruneSelection,
  selectAdded,
  selectAll,
  selectKeys,
  selectMarquee,
  selectMember,
  type Selection,
} from "./selection";

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

  it("replaces a selected component with the member on shift+cmd", () => {
    const componentKey = componentSelectionKey("build-1");
    expect(selectMember({ keys: [componentKey], mode: "single" }, "build-1/post-1#0", true, true)).toEqual({
      keys: ["build-1/post-1#0"],
      mode: "single",
    });
  });

  it("adds another member and drops a component key", () => {
    const componentKey = componentSelectionKey("build-1");
    const post = "build-1/post-1#0";
    const rail = "build-1/rail-1#0";
    expect(selectMember(multi([componentKey, post]), rail, true, true)).toEqual(multi([post, rail]));
  });

  it("toggles a member off without bringing the component back", () => {
    const componentKey = componentSelectionKey("build-1");
    const post = "build-1/post-1#0";
    const rail = "build-1/rail-1#0";
    expect(selectMember(multi([componentKey, post, rail]), post, true, true)).toEqual(multi([rail]));
    expect(selectMember(multi([componentKey, post]), post, true, true)).toEqual(EMPTY_SELECTION);
  });
});

describe("hitSelectionKey", () => {
  const memberKey = "build-1/post-1#0";
  const componentKey = componentSelectionKey("build-1");

  it("selects the member on the first plain click", () => {
    expect(hitSelectionKey(EMPTY_SELECTION, memberKey)).toBe(memberKey);
  });

  it("selects the member when that component is already the sole selection", () => {
    expect(hitSelectionKey({ keys: [componentKey], mode: "single" }, memberKey)).toBe(memberKey);
  });

  it("selects members even when another component is selected", () => {
    expect(hitSelectionKey({ keys: [componentSelectionKey("group-1")], mode: "single" }, memberKey)).toBe(memberKey);
  });

  it("selects the component consistently on modifier clicks", () => {
    expect(hitSelectionKey(EMPTY_SELECTION, memberKey, { member: false })).toBe(componentKey);
    expect(hitSelectionKey({ keys: [componentKey], mode: "single" }, memberKey, { member: false })).toBe(componentKey);
  });
});

describe("linked copy eligibility", () => {
  const scene = compileDocument(`version: 2
name: Selection
members:
  - { label: Post, stock: 2x4x8 }
components:
  - label: Build
    position: [0, 0, 0]
    members:
      - { id: post-1, position: [0, 0, 0] }
  - label: Pair
    position: [10, 0, 0]
    members:
      - { id: post-1, position: [0, 0, 0] }
      - { id: post-1, position: [0, 0, 10] }
  - label: Single
    position: [20, 0, 0]
    members:
      - { id: post-1, position: [0, 0, 0] }
`).scene!;

  it("never targets Build, even on a modifier click", () => {
    const key = "build-1/post-1#0";
    expect(hitSelectionKey(EMPTY_SELECTION, key, { member: false, component: scene.components[0] })).toBe(key);
  });

  it("links only one explicitly selected multi-member component", () => {
    expect(linkedCopyComponent(["component:pair-1"], scene)?.id).toBe("pair-1");
    for (const keys of [[], ["pair-1/post-1#0"], ["component:single-1"], ["component:build-1"],
      ["component:pair-1", "component:single-1"], ["component:pair-1", "pair-1/post-1#0"],
      ["pair-1/post-1#0", "pair-1/post-1#1"]]) {
      expect(linkedCopyComponent(keys, scene)).toBeUndefined();
    }
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

describe("selectMarquee", () => {
  const componentKey = componentSelectionKey("build-1");
  const post = "build-1/post-1#0";
  const rail = "build-1/rail-1#0";

  it("appends member keys and drops a previously selected component", () => {
    expect(selectMarquee({ keys: [componentKey], mode: "single" }, [post, rail], true)).toEqual(multi([post, rail]));
  });

  it("appends component keys and keeps the current selection", () => {
    expect(selectMarquee({ keys: [post], mode: "single" }, [componentKey], false)).toEqual(multi([post, componentKey]));
  });

  it("returns the same selection for an empty box", () => {
    const current = { keys: [componentKey], mode: "single" as const };
    expect(selectMarquee(current, [], true)).toBe(current);
    expect(selectMarquee(current, [], false)).toBe(current);
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
