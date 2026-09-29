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

/** Append members that are not already selected. An empty or redundant list returns the same selection. */
export function selectAdded(current: Selection, keys: readonly string[]): Selection {
  if (keys.length === 0) return current;
  const seen = new Set(current.keys);
  const next = [...current.keys];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(key);
  }
  if (next.length === current.keys.length) return current;
  if (next.length === 1) return { keys: next, mode: "single" };
  return { keys: next, mode: "multi" };
}

/** Replace the selection with these members. An empty list leaves the selection unchanged. */
export function selectKeys(current: Selection, keys: readonly string[]): Selection {
  if (keys.length === 0) return current;
  const mode = keys.length === 1 ? "single" : "multi";
  if (
    current.mode === mode &&
    current.keys.length === keys.length &&
    current.keys.every((key, index) => key === keys[index])
  ) {
    return current;
  }
  return { keys: [...keys], mode };
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
