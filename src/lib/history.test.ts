import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  currentYaml,
  emptyHistory,
  HISTORY_LIMIT,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";

describe("history ring buffer", () => {
  it("ignores a push of the current yaml", () => {
    const first = pushHistory(emptyHistory(), "a");
    expect(pushHistory(first, "a")).toEqual(first);
  });

  it("undoes and redoes", () => {
    let state = emptyHistory();
    state = pushHistory(state, "a");
    state = pushHistory(state, "b");
    state = pushHistory(state, "c");
    expect(currentYaml(state)).toBe("c");
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);

    const undone = undoHistory(state);
    expect(undone).toBeDefined();
    expect(currentYaml(undone!)).toBe("b");
    expect(canRedo(undone!)).toBe(true);

    const redone = redoHistory(undone!);
    expect(currentYaml(redone!)).toBe("c");
  });

  it("drops the redo tail on a new push", () => {
    let state = pushHistory(pushHistory(pushHistory(emptyHistory(), "a"), "b"), "c");
    state = undoHistory(state)!;
    state = pushHistory(state, "d");
    expect(state.entries).toEqual(["a", "b", "d"]);
    expect(currentYaml(state)).toBe("d");
    expect(canRedo(state)).toBe(false);
  });

  it("caps at the limit by dropping the oldest", () => {
    let state = emptyHistory();
    for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
      state = pushHistory(state, `v${index}`);
    }
    expect(state.entries).toHaveLength(HISTORY_LIMIT);
    expect(state.entries[0]).toBe("v5");
    expect(currentYaml(state)).toBe(`v${HISTORY_LIMIT + 4}`);
    expect(canUndo(state)).toBe(true);
  });

  it("does nothing at the ends of the stack", () => {
    const state = pushHistory(emptyHistory(), "a");
    expect(undoHistory(state)).toBeUndefined();
    expect(redoHistory(state)).toBeUndefined();
  });
});
