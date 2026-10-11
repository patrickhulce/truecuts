import { parseInstanceKey } from "./fasteners";
import { findSceneComponent, membersUnder, type SceneComponent, type SceneModel } from "./scene";

export type SelectionMode = "single" | "multi";

export type Selection = {
  keys: string[];
  mode: SelectionMode;
};

export const EMPTY_SELECTION: Selection = { keys: [], mode: "single" };

const COMPONENT_PREFIX = "component:";

/** Selection key for a component occurrence. Member keys stay `occurrence/member#index`. */
export function componentSelectionKey(occurrenceId: string): string {
  return `${COMPONENT_PREFIX}${occurrenceId}`;
}

/** Occurrence id when `key` selects a component. Null for a member key. */
export function componentIdOfSelection(key: string): string | null {
  return key.startsWith(COMPONENT_PREFIX) ? key.slice(COMPONENT_PREFIX.length) : null;
}

/**
 * Plain clicks always select members. Cmd/Ctrl-click selects their component.
 * The catch-all Build container is never a viewport selection target.
 */
export function hitSelectionKey(_current: Selection, memberKey: string, options?: { member?: boolean; component?: SceneComponent }): string {
  if (options?.member !== false || (options.component && !canSelectComponent(options.component))) return memberKey;
  let componentId: string;
  try {
    componentId = parseInstanceKey(memberKey).componentId;
  } catch {
    return memberKey;
  }
  const componentKey = componentSelectionKey(componentId);
  return componentKey;
}

export function canSelectComponent(component: SceneComponent): boolean {
  return component.label.trim().toLowerCase() !== "build";
}

/** Only an explicitly selected, single, multi-member component is copied linked. */
export function linkedCopyComponent(keys: readonly string[], scene: SceneModel): SceneComponent | undefined {
  const id = keys.length === 1 ? componentIdOfSelection(keys[0]) : null;
  const component = id ? findSceneComponent(scene.components, id) : undefined;
  return component && canSelectComponent(component) && membersUnder(component).length > 1 ? component : undefined;
}

/**
 * Plain click replaces the selection. Shift toggles that key.
 * A member hit drops component keys before the toggle.
 * One member left after dropping a component selection stays single.
 * An existing member multi-selection stays multi.
 */
export function selectMember(current: Selection, key: string, shift: boolean, member = false): Selection {
  if (!shift) return { keys: [key], mode: "single" };
  const droppedComponent = member && current.keys.some((item) => componentIdOfSelection(item) !== null);
  const base = member ? current.keys.filter((item) => componentIdOfSelection(item) === null) : current.keys;
  const keys = base.includes(key) ? base.filter((item) => item !== key) : [...base, key];
  if (keys.length === 0) return EMPTY_SELECTION;
  if (droppedComponent && base.length === 0 && keys.length === 1) return { keys, mode: "single" };
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

/**
 * Append marquee hits. Member hits drop component keys first.
 * An empty list returns the same selection.
 */
export function selectMarquee(current: Selection, keys: readonly string[], member = false): Selection {
  if (keys.length === 0) return current;
  if (!member) return selectAdded(current, keys);
  const members = current.keys.filter((item) => componentIdOfSelection(item) === null);
  const base = members.length === current.keys.length ? current : { keys: members, mode: current.mode };
  return selectAdded(base, keys);
}

/**
 * Replace the selection with these members. An empty list leaves the selection unchanged.
 * Pass `mode` when a one-member group should stay on the tree instead of opening detail.
 */
export function selectKeys(current: Selection, keys: readonly string[], mode?: SelectionMode): Selection {
  if (keys.length === 0) return current;
  const nextMode = mode ?? (keys.length === 1 ? "single" : "multi");
  if (
    current.mode === nextMode &&
    current.keys.length === keys.length &&
    current.keys.every((key, index) => key === keys[index])
  ) {
    return current;
  }
  return { keys: [...keys], mode: nextMode };
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
