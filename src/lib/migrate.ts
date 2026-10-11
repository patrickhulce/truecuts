import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";
import { formatDocumentYaml } from "./edit";

function renameKey(map: YAMLMap, from: string, to: string): boolean {
  if (!map.has(from) || map.has(to)) return false;
  const value = map.get(from, true);
  map.delete(from);
  map.set(to, value);
  return true;
}

function renameFastenerMembers(node: unknown): boolean {
  if (!isSeq(node)) return false;
  let changed = false;
  for (const fastener of node.items) {
    if (!isMap(fastener)) continue;
    const members = fastener.get("members", true);
    if (!isSeq(members)) continue;
    for (const member of members.items) {
      if (isMap(member) && renameKey(member, "part", "id")) changed = true;
    }
  }
  return changed;
}

/**
 * Rewrite a stored document from `parts` / `holes` / placement `part` onto
 * `members` / `bores` / `id`. Returns the original text when nothing changes
 * or the YAML cannot be parsed.
 */
export function migrateDocumentYaml(text: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return text;
  const root = doc.contents;
  let changed = false;

  if (renameKey(root, "parts", "members")) changed = true;
  const members = root.get("members", true);
  if (isSeq(members)) {
    for (const member of members.items) {
      if (isMap(member) && renameKey(member, "holes", "bores")) changed = true;
    }
  }

  const components = root.get("components", true);
  if (isSeq(components)) {
    for (const component of components.items) {
      if (!isMap(component)) continue;
      if (renameKey(component, "parts", "members")) changed = true;
      const placements = component.get("members", true);
      if (isSeq(placements)) {
        for (const placement of placements.items) {
          if (isMap(placement) && renameKey(placement, "part", "id")) changed = true;
        }
      }
      if (renameFastenerMembers(component.get("fasteners", true))) changed = true;
    }
  }
  if (renameFastenerMembers(root.get("fasteners", true))) changed = true;

  const version = root.get("version", true);
  if (isScalar(version) && version.toJSON() === 1) {
    (version as unknown as { value: number }).value = 2;
    changed = true;
    const placed = root.get("components", true);
    if (isSeq(placed)) {
      for (const component of placed.items) {
        if (!isMap(component) || component.has("position")) continue;
        component.set("position", doc.createNode([0, 0, 0]));
        const position = component.get("position", true);
        if (isSeq(position)) position.flow = true;
        changed = true;
      }
    }
  }

  return changed ? formatDocumentYaml(doc.toString()) : text;
}
