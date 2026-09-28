export type SelectionMode = "single" | "multi";

export type Selection = {
  keys: string[];
  mode: SelectionMode;
};

export const EMPTY_SELECTION: Selection = { keys: [], mode: "single" };

/** Plain click replaces the selection. Shift-click toggles that member and keeps the rest. */
export function selectMember(current: Selection, key: string, shift: boolean): Selection {
  if (!shift) return { keys: [key], mode: "single" };
  const keys = current.keys.includes(key)
    ? current.keys.filter((item) => item !== key)
    : [...current.keys, key];
  return { keys, mode: "multi" };
}

/** Every member. A single member stays in single mode so the detail pane still applies. */
export function selectAll(keys: readonly string[]): Selection {
  if (keys.length === 0) return EMPTY_SELECTION;
  if (keys.length === 1) return { keys: [keys[0]], mode: "single" };
  return { keys: [...keys], mode: "multi" };
}

/** Drop instance keys that are no longer in the scene. An empty result leaves multi mode. */
export function pruneSelection(current: Selection, live: ReadonlySet<string>): Selection {
  const keys = current.keys.filter((key) => live.has(key));
  if (keys.length === current.keys.length) return current;
  if (keys.length === 0) return EMPTY_SELECTION;
  return { keys, mode: current.mode };
}
