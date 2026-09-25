import { isMap, isSeq, parseDocument, type Document } from "yaml";
import { getFastenerSubtype } from "./catalog";
import { assignIds, type Labeled } from "./identity";
import type { Vec3 } from "./geometry";
import type { RawConnectionFastener } from "./schema";

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

const STRINGIFY = { lineWidth: 0 } as const;

function parseEditDocument(text: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new EditError(doc.errors[0]?.message ?? "Invalid YAML");
  }
  return doc;
}

function asLabeled(value: unknown, path: string): Labeled {
  if (!value || typeof value !== "object") {
    throw new EditError(`Expected a mapping at ${path}`);
  }
  const record = value as { id?: unknown; label?: unknown };
  if (typeof record.label !== "string" || record.label.length === 0) {
    throw new EditError(`Missing label at ${path}`);
  }
  return {
    label: record.label,
    id: typeof record.id === "string" ? record.id : undefined,
  };
}

function identified(doc: Document): {
  members: (Labeled & { id: string })[];
  components: (Labeled & { id: string })[];
} {
  const data = doc.toJS() ?? {};
  const rawMembers = Array.isArray(data.members) ? data.members : [];
  const rawComponents = Array.isArray(data.components) ? data.components : [];
  const labeledMembers = rawMembers.map((member: unknown, index: number) => asLabeled(member, `members[${index}]`));
  const labeledComponents = rawComponents.map((component: unknown, index: number) =>
    asLabeled(component, `components[${index}]`),
  );
  try {
    const assigned = assignIds([...labeledMembers, ...labeledComponents]);
    return {
      members: assigned.slice(0, labeledMembers.length),
      components: assigned.slice(labeledMembers.length),
    };
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error));
  }
}

function seqLength(doc: Document, path: Array<string | number>): number {
  const node = doc.getIn(path);
  return isSeq(node) ? node.items.length : 0;
}

export const SNAP_INCH = 0.5;
export const SNAP_INCH_FINE = 0.0625;
export const SNAP_DEG = 45;
export const SNAP_DEG_FINE = 15;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Number((Math.round(value * factor) / factor).toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundInches(value: number): number {
  return roundTo(value, 4);
}

export function roundDegrees(value: number): number {
  return roundTo(value, 1);
}

export function snapValue(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  return roundTo(Math.round(value / step) * step, 4);
}

export function snapPosition(position: Vec3, step: number): Vec3 {
  return [snapValue(position[0], step), snapValue(position[1], step), snapValue(position[2], step)];
}

export function snapRotation(rotation: Vec3, step: number): Vec3 {
  return [snapValue(rotation[0], step), snapValue(rotation[1], step), snapValue(rotation[2], step)];
}

export function snapSteps(fine: boolean): { inch: number; deg: number } {
  return fine ? { inch: SNAP_INCH_FINE, deg: SNAP_DEG_FINE } : { inch: SNAP_INCH, deg: SNAP_DEG };
}

function roundVec(value: Vec3, decimals: number): Vec3 {
  return [roundTo(value[0], decimals), roundTo(value[1], decimals), roundTo(value[2], decimals)];
}

function setVec3(doc: Document, path: Array<string | number>, value: Vec3, decimals: number): void {
  const rounded = roundVec(value, decimals);
  const existing = doc.getIn(path, true);
  const node = doc.createNode(rounded);
  if (isSeq(node)) {
    node.flow = isSeq(existing) ? Boolean(existing.flow) : true;
  }
  doc.setIn(path, node);
}

function stripMembers(doc: Document, membersPath: Array<string | number>, memberId: string): void {
  const members = doc.getIn(membersPath);
  if (!isSeq(members)) return;
  for (let index = members.items.length - 1; index >= 0; index--) {
    const id = doc.getIn([...membersPath, index, "id"]);
    if (id === memberId) {
      doc.deleteIn([...membersPath, index]);
    }
  }
}

function stripFastenerSeq(doc: Document, seqPath: Array<string | number>, memberId: string): void {
  const seq = doc.getIn(seqPath);
  if (!isSeq(seq)) return;
  for (let index = seq.items.length - 1; index >= 0; index--) {
    const membersPath = [...seqPath, index, "members"];
    stripMembers(doc, membersPath, memberId);
    if (seqLength(doc, membersPath) < 2) {
      doc.deleteIn([...seqPath, index]);
    }
  }
}

function stripConnectionSeq(doc: Document, seqPath: Array<string | number>, memberId: string): void {
  const seq = doc.getIn(seqPath);
  if (!isSeq(seq)) return;
  for (let index = seq.items.length - 1; index >= 0; index--) {
    const membersPath = [...seqPath, index, "members"];
    stripMembers(doc, membersPath, memberId);
    const fastenersPath = [...seqPath, index, "fasteners"];
    const fasteners = doc.getIn(fastenersPath);
    if (isSeq(fasteners)) {
      for (let fIndex = fasteners.items.length - 1; fIndex >= 0; fIndex--) {
        if (doc.getIn([...fastenersPath, fIndex, "variant", "bracket"]) === memberId) {
          doc.deleteIn([...fastenersPath, fIndex]);
        }
      }
    }
    if (seqLength(doc, membersPath) < 2 || seqLength(doc, fastenersPath) < 1) {
      doc.deleteIn([...seqPath, index]);
    }
  }
}

/**
 * Remove a member definition and every placement, fastener, and connection that references it.
 * Fasteners or connections left with fewer than two members are dropped.
 */
export function deleteMember(text: string, memberId: string): string {
  const doc = parseEditDocument(text);
  const { members } = identified(doc);
  const memberIndex = members.findIndex((member) => member.id === memberId);
  if (memberIndex < 0) {
    throw new EditError(`Unknown member "${memberId}"`);
  }

  const componentCount = seqLength(doc, ["components"]);
  for (let cIndex = 0; cIndex < componentCount; cIndex++) {
    const membersPath = ["components", cIndex, "members"] as Array<string | number>;
    const placements = doc.getIn(membersPath);
    if (isSeq(placements)) {
      for (let pIndex = placements.items.length - 1; pIndex >= 0; pIndex--) {
        if (doc.getIn([...membersPath, pIndex, "id"]) === memberId) {
          doc.deleteIn([...membersPath, pIndex]);
        }
      }
    }
    stripFastenerSeq(doc, ["components", cIndex, "fasteners"], memberId);
    stripConnectionSeq(doc, ["components", cIndex, "connections"], memberId);
  }
  stripFastenerSeq(doc, ["fasteners"], memberId);
  stripConnectionSeq(doc, ["connections"], memberId);
  doc.deleteIn(["members", memberIndex]);
  return doc.toString(STRINGIFY);
}

/**
 * Write a placement's component-local position (inches) and XYZ euler rotation (degrees).
 */
export function setPlacementPose(
  text: string,
  componentId: string,
  placementIndex: number,
  position: Vec3,
  rotation: Vec3,
): string {
  const doc = parseEditDocument(text);
  const { components } = identified(doc);
  const cIndex = components.findIndex((component) => component.id === componentId);
  if (cIndex < 0) {
    throw new EditError(`Unknown component "${componentId}"`);
  }
  if (placementIndex < 0 || placementIndex >= seqLength(doc, ["components", cIndex, "members"])) {
    throw new EditError(
      `Placement index ${placementIndex} is out of range in component "${componentId}"`,
    );
  }
  const base = ["components", cIndex, "members", placementIndex] as Array<string | number>;
  setVec3(doc, [...base, "position"], position, 4);
  setVec3(doc, [...base, "rotation"], rotation, 1);
  return doc.toString(STRINGIFY);
}

function componentIndex(doc: Document, componentId: string): number {
  const { components } = identified(doc);
  const cIndex = components.findIndex((component) => component.id === componentId);
  if (cIndex < 0) throw new EditError(`Unknown component "${componentId}"`);
  return cIndex;
}

function connectionBase(doc: Document, componentId: string | null): Array<string | number> {
  if (!componentId) return ["connections"];
  return ["components", componentIndex(doc, componentId), "connections"];
}

/** Replace one fastener recipe on a connection. Creates the fasteners sequence entry if needed. */
export function setConnectionFastener(
  text: string,
  componentId: string | null,
  connectionIndex: number,
  fastenerIndex: number,
  fastener: RawConnectionFastener,
): string {
  const doc = parseEditDocument(text);
  const base = connectionBase(doc, componentId);
  if (connectionIndex < 0 || connectionIndex >= seqLength(doc, base)) {
    throw new EditError(`Connection index ${connectionIndex} is out of range`);
  }
  const fastenersPath = [...base, connectionIndex, "fasteners"];
  if (fastenerIndex < 0 || fastenerIndex >= seqLength(doc, fastenersPath)) {
    throw new EditError(`Fastener index ${fastenerIndex} is out of range`);
  }
  doc.setIn([...fastenersPath, fastenerIndex], doc.createNode(fastener));
  return doc.toString(STRINGIFY);
}

export function defaultConnectionFastener(stock: string): RawConnectionFastener {
  const subtype = getFastenerSubtype(stock);
  if (subtype === "glue") return { kind: "glue", stock, variant: { kind: "patch" } };
  if (subtype === "bolt") return { kind: "bolt", stock, variant: { kind: "through" } };
  return {
    kind: "screw",
    stock: subtype === "screw" ? stock : "screw-wood-8x2",
    variant: { kind: "centered", separation: 4, justify: "space-around" },
  };
}

/**
 * Turn explicit fasteners into one connection recipe and drop the explicit entries.
 * `explicitIndexes` are indexes in that component's (or the document's) `fasteners` list.
 */
export function promoteExplicitFasteners(
  text: string,
  componentId: string | null,
  explicitIndexes: number[],
): string {
  const doc = parseEditDocument(text);
  const fastenerPath = componentId
    ? ["components", componentIndex(doc, componentId), "fasteners"]
    : ["fasteners"];
  const indexes = [...new Set(explicitIndexes)].sort((a, b) => a - b);
  const recipes: RawConnectionFastener[] = [];
  const memberNodes: Array<{ id: string; component?: string }> = [];
  const seenMembers = new Set<string>();

  for (const index of indexes) {
    const raw = doc.getIn([...fastenerPath, index]);
    if (!isMap(raw)) throw new EditError(`Explicit fastener ${index} is missing`);
    const stock = doc.getIn([...fastenerPath, index, "stock"]);
    if (typeof stock !== "string") throw new EditError(`Explicit fastener ${index} has no stock`);
    recipes.push(defaultConnectionFastener(stock));
    const members = doc.getIn([...fastenerPath, index, "members"]);
    if (!isSeq(members)) continue;
    for (let mIndex = 0; mIndex < members.items.length; mIndex++) {
      const id = doc.getIn([...fastenerPath, index, "members", mIndex, "id"]);
      const component = doc.getIn([...fastenerPath, index, "members", mIndex, "component"]);
      if (typeof id !== "string") continue;
      const key = `${typeof component === "string" ? component : ""}/${id}`;
      if (seenMembers.has(key)) continue;
      seenMembers.add(key);
      memberNodes.push(typeof component === "string" ? { id, component } : { id });
    }
  }

  if (memberNodes.length < 2 || recipes.length === 0) {
    throw new EditError("Need at least two members to promote a connection");
  }

  for (const index of [...indexes].reverse()) {
    doc.deleteIn([...fastenerPath, index]);
  }

  const connectionsPath = connectionBase(doc, componentId);
  const existing = doc.getIn(connectionsPath);
  const nextIndex = isSeq(existing) ? existing.items.length : 0;
  if (!isSeq(existing)) doc.setIn(connectionsPath, doc.createNode([]));
  doc.setIn([...connectionsPath, nextIndex], doc.createNode({ members: memberNodes, fasteners: recipes }));
  return doc.toString(STRINGIFY);
}
