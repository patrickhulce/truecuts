import { isMap, isPair, isScalar, isSeq, parseDocument, type Document } from "yaml";
import { getCatalogPart, getFastenerSubtype, resolveStockSize, stockGeometry, type AxisName } from "./catalog";
import { freeAxes, sizeOverride } from "./catalog-families";
import { assignIds, type Labeled } from "./identity";
import { add, axisCoord, faceFrame, isFaceId, rotateEulerXYZ, type Vec3 } from "./geometry";
import type { RawConnectionFastener } from "./schema";
import { formatInches, parseDimension } from "./units";

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

const STRINGIFY = { lineWidth: 80 } as const;
const FLOW_SEQUENCES = new Set(["position", "rotation", "size", "at"]);

function scalarKey(key: unknown): string | null {
  if (typeof key === "string") return key;
  return isScalar(key) && typeof key.value === "string" ? key.value : null;
}

function fitsOnOneLine(node: { flow?: boolean; toString: () => string }): boolean {
  const previous = node.flow;
  node.flow = true;
  let rendered = "";
  try {
    rendered = node.toString().trim();
  } catch {
    node.flow = previous;
    return false;
  }
  node.flow = previous;
  return rendered.length > 0 && rendered.length <= STRINGIFY.lineWidth && !rendered.includes("\n");
}

/** Block-print components and placements. Keep short vectors, cuts, and fasteners in flow. */
function styleNode(node: unknown, key: string | null, ancestors: readonly string[]): void {
  if (isSeq(node)) {
    node.flow = key !== null && FLOW_SEQUENCES.has(key);
    const next = key === null ? ancestors : [...ancestors, key];
    for (const child of node.items) styleNode(child, null, next);
    return;
  }
  if (!isMap(node)) return;
  const next = key === null ? ancestors : [...ancestors, key];
  for (const item of node.items) styleNode(item.value, scalarKey(item.key), next);
  const parent = ancestors[ancestors.length - 1];
  const compact =
    key === "variant" ||
    parent === "cuts" ||
    parent === "fasteners" ||
    (parent === "members" && (ancestors.includes("connections") || ancestors.includes("fasteners")));
  node.flow = compact && fitsOnOneLine(node);
}

function stringifyDocument(doc: Document): string {
  if (doc.contents) styleNode(doc.contents, null, []);
  const text = doc.toString(STRINGIFY);
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Pretty-print a document. Invalid YAML is returned unchanged. */
export function formatDocumentYaml(text: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !doc.contents) return text;
  return stringifyDocument(doc);
}

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

/**
 * Write derived ids onto members and components that omit them.
 * Ids come from document order, so inserting or removing an entry renumbers
 * later ones and leaves placements and connections pointing at ids that no
 * longer exist.
 */
function pinAssignedIds(doc: Document): void {
  const { members, components } = identified(doc);
  members.forEach((member, index) => pinId(doc, ["members", index], member.id));
  components.forEach((component, index) => pinId(doc, ["components", index], component.id));
}

function pinId(doc: Document, path: Array<string | number>, id: string): void {
  const current = doc.getIn([...path, "id"]);
  if (typeof current === "string" && current.length > 0) return;
  const node = doc.getIn(path, true);
  if (!isMap(node)) return;
  if (node.has("id")) node.delete("id");
  node.items.unshift(doc.createPair("id", id));
}

function seqLength(doc: Document, path: Array<string | number>): number {
  const node = doc.getIn(path);
  return isSeq(node) ? node.items.length : 0;
}

export const SNAP_INCH = 1;
export const SNAP_INCH_FINE = 0.125;
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

export type MemberCutInput = {
  axis: 0 | 1 | 2;
  angle: number;
  at: number | [number, number];
  side?: "end" | "start";
  around?: 0 | 1 | 2;
};

export type NewMemberInput = {
  label: string;
  stock: string;
  /** Free axes of parameterized stock, in L, W, then T order. */
  size?: number[];
  cuts?: MemberCutInput[];
  /** Place into this component. Omitted uses the first component, or creates a Build. */
  componentId?: string;
  position?: Vec3;
  rotation?: Vec3;
};

export const CATALOG_DRAG_MIME = "application/x-truecuts-catalog";

export function parseCatalogDrag(raw: string): NewMemberInput | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as { label?: unknown; stock?: unknown; size?: unknown; cuts?: unknown };
  if (typeof record.label !== "string" || typeof record.stock !== "string") return null;
  if (record.size !== undefined && !isNumberList(record.size)) return null;
  const cuts = record.cuts === undefined ? undefined : parseDragCuts(record.cuts);
  if (cuts === null) return null;
  return {
    label: record.label,
    stock: record.stock,
    size: isNumberList(record.size) ? record.size : undefined,
    cuts,
  };
}

function flowSequences(node: unknown, keys: Set<string>): void {
  if (!isMap(node)) return;
  for (const item of node.items) {
    const key = isScalar(item.key) ? item.key.value : undefined;
    if (isSeq(item.value) && typeof key === "string" && keys.has(key)) {
      item.value.flow = true;
      for (const child of item.value.items) {
        if (isMap(child)) {
          child.flow = true;
          flowSequences(child, keys);
        }
      }
    } else if (isMap(item.value)) {
      flowSequences(item.value, keys);
    } else if (isSeq(item.value)) {
      for (const child of item.value.items) flowSequences(child, keys);
    }
  }
}

function memberNode(doc: Document, input: NewMemberInput) {
  const value: Record<string, unknown> = {
    label: input.label.trim(),
    stock: input.stock,
  };
  if (input.size && input.size.length > 0) value.size = input.size;
  if (input.cuts && input.cuts.length > 0) value.cuts = input.cuts;
  const node = doc.createNode(value);
  flowSequences(node, new Set(["size", "cuts", "at"]));
  return node;
}

function placementNode(doc: Document, memberId: string, position?: Vec3, rotation?: Vec3) {
  const node = doc.createNode(
    {
      id: memberId,
      position: roundVec(position ?? [0, 0, 0], 4),
      rotation: roundVec(rotation ?? [0, 0, 0], 1),
    },
    { flow: true },
  );
  flowSequences(node, new Set(["position", "rotation"]));
  return node;
}

function ensureSeq(doc: Document, path: Array<string | number>): void {
  if (!isSeq(doc.getIn(path))) doc.setIn(path, doc.createNode([]));
}

/**
 * Append a member and place it at the origin of the first component.
 * A document with no components gains a Build component for that placement.
 */
export function addMember(text: string, input: NewMemberInput): string {
  const label = input.label.trim();
  if (!label) throw new EditError("Member label is required");
  if (!input.stock.trim()) throw new EditError("Member stock is required");
  if (input.size?.some((value) => !Number.isFinite(value))) {
    throw new EditError("Size values must be finite numbers");
  }

  const doc = parseEditDocument(text);
  pinAssignedIds(doc);
  ensureSeq(doc, ["members"]);
  const memberIndex = seqLength(doc, ["members"]);
  doc.setIn(["members", memberIndex], memberNode(doc, { ...input, label }));

  const { members } = identified(doc);
  const newId = members[members.length - 1]?.id;
  if (!newId) throw new EditError("Could not assign a member id");

  if (seqLength(doc, ["components"]) === 0) {
    const component = doc.createNode({
      label: "Build",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      members: [
        {
          id: newId,
          position: roundVec(input.position ?? [0, 0, 0], 4),
          rotation: roundVec(input.rotation ?? [0, 0, 0], 1),
        },
      ],
    });
    flowSequences(component, new Set(["position", "rotation"]));
    if (isMap(component)) {
      const membersPair = component.items.find((item) => isScalar(item.key) && item.key.value === "members");
      if (membersPair && isSeq(membersPair.value)) {
        for (const placement of membersPair.value.items) {
          if (isMap(placement)) placement.flow = true;
        }
      }
    }
    ensureSeq(doc, ["components"]);
    doc.setIn(["components", 0], component);
  } else {
    const cIndex = input.componentId ? componentIndex(doc, input.componentId) : 0;
    ensureSeq(doc, ["components", cIndex, "members"]);
    const placementIndex = seqLength(doc, ["components", cIndex, "members"]);
    doc.setIn(
      ["components", cIndex, "members", placementIndex],
      placementNode(doc, newId, input.position, input.rotation),
    );
  }

  return stringifyDocument(doc);
}

/**
 * Remove a member definition and every placement, fastener, and connection that references it.
 * Fasteners or connections left with fewer than two members are dropped.
 */
export function deleteMember(text: string, memberId: string): string {
  const doc = parseEditDocument(text);
  pinAssignedIds(doc);
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
  return stringifyDocument(doc);
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
  return stringifyDocument(doc);
}

/** Write a component's world position (inches) and XYZ euler rotation (degrees). */
export function setComponentPose(text: string, componentId: string, position: Vec3, rotation: Vec3): string {
  const doc = parseEditDocument(text);
  const cIndex = componentIndex(doc, componentId);
  setVec3(doc, ["components", cIndex, "position"], position, 4);
  setVec3(doc, ["components", cIndex, "rotation"], rotation, 1);
  return stringifyDocument(doc);
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
  return stringifyDocument(doc);
}

export function defaultConnectionFastener(stock: string): RawConnectionFastener {
  const subtype = getFastenerSubtype(stock);
  if (subtype === "glue") return { kind: "glue", stock, variant: { kind: "patch" } };
  if (subtype === "bolt") return { kind: "bolt", stock, variant: { kind: "through" } };
  if (subtype === "nail") {
    return { kind: "nail", stock, variant: { kind: "centered", separation: 4, justify: "space-around" } };
  }
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
  return stringifyDocument(doc);
}

export type ConnectionMemberRef = {
  componentId: string;
  id: string;
  /** Occurrence of this member id in the component. Omitted from YAML when 0. */
  index?: number;
};

/** Append a connection. Members in one component stay on that component; otherwise the connection is document-level. */
export function addConnection(
  text: string,
  members: ConnectionMemberRef[],
  fastener: RawConnectionFastener = { kind: "none" },
): string {
  if (members.length < 2) throw new EditError("Need at least two members to add a connection");
  const doc = parseEditDocument(text);
  const shared = members.every((member) => member.componentId === members[0]?.componentId)
    ? (members[0]?.componentId ?? null)
    : null;
  const memberNodes = members.map((member) => {
    const node: { id: string; component?: string; index?: number } = { id: member.id };
    if (!shared) node.component = member.componentId;
    if (member.index && member.index > 0) node.index = member.index;
    return node;
  });
  const connectionsPath = connectionBase(doc, shared);
  const existing = doc.getIn(connectionsPath);
  const nextIndex = isSeq(existing) ? existing.items.length : 0;
  if (!isSeq(existing)) doc.setIn(connectionsPath, doc.createNode([]));
  doc.setIn([...connectionsPath, nextIndex], doc.createNode({ members: memberNodes, fasteners: [fastener] }));
  return stringifyDocument(doc);
}

const DIMENSION_AXIS = ["L", "W", "T"] as const;

type StoredCut = MemberCutInput & { side?: "end" | "start" };

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function parseDragCuts(value: unknown): MemberCutInput[] | null {
  if (!Array.isArray(value)) return null;
  const cuts: MemberCutInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const cut = item as { axis?: unknown; angle?: unknown; at?: unknown; side?: unknown; around?: unknown };
    if (cut.axis !== 0 && cut.axis !== 1 && cut.axis !== 2) return null;
    if (typeof cut.angle !== "number" || !Number.isFinite(cut.angle)) return null;
    const next: MemberCutInput = { axis: cut.axis, angle: cut.angle, at: 0 };
    if (typeof cut.at === "number" && Number.isFinite(cut.at)) next.at = cut.at;
    else if (isNumberList(cut.at) && cut.at.length === 2) next.at = [cut.at[0], cut.at[1]];
    else return null;
    if (cut.side === "end" || cut.side === "start") next.side = cut.side;
    if (cut.around === 0 || cut.around === 1 || cut.around === 2) next.around = cut.around;
    cuts.push(next);
  }
  return cuts;
}

function asInches(value: unknown, label: string): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new EditError(`${label} is not a dimension`);
  }
  try {
    return parseDimension(value);
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error));
  }
}

function readSizeOverride(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new EditError("Member size is not a list");
  return value.map((item, index) => asInches(item, `Size value ${index + 1}`));
}

function readStoredCuts(value: unknown): StoredCut[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const cuts: StoredCut[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const cut = item as { axis?: unknown; angle?: unknown; at?: unknown; side?: unknown; around?: unknown };
    if (cut.axis !== 0 && cut.axis !== 1 && cut.axis !== 2) return null;
    if (typeof cut.angle !== "number" || !Number.isFinite(cut.angle)) return null;
    let at: number | [number, number];
    if (Array.isArray(cut.at)) {
      if (cut.at.length !== 2) return null;
      at = [asInches(cut.at[0], "Cut at"), asInches(cut.at[1], "Cut at")];
    } else {
      at = asInches(cut.at, "Cut at");
    }
    const stored: StoredCut = { axis: cut.axis, angle: cut.angle, at };
    if (cut.side === "end" || cut.side === "start") stored.side = cut.side;
    if (cut.around === 0 || cut.around === 1 || cut.around === 2) stored.around = cut.around;
    cuts.push(stored);
  }
  return cuts;
}

function memberRecord(doc: Document, index: number): { stock: string; size?: number[]; cuts: StoredCut[] | null } {
  const node = doc.getIn(["members", index]);
  const value = isMap(node) ? node.toJS(doc) : node;
  if (!value || typeof value !== "object") throw new EditError("Member is missing");
  const record = value as { stock?: unknown; size?: unknown; cuts?: unknown };
  if (typeof record.stock !== "string" || record.stock.length === 0) {
    throw new EditError("Member stock is missing");
  }
  return {
    stock: record.stock,
    size: readSizeOverride(record.size),
    cuts: readStoredCuts(record.cuts),
  };
}

function axisIndex(axis: AxisName): 0 | 1 | 2 {
  if (axis === "L") return 0;
  if (axis === "W") return 1;
  return 2;
}

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-4;
}

function isSquareCut(cut: StoredCut): cut is StoredCut & { at: number } {
  return Math.abs(cut.angle - 90) < 1e-6 && typeof cut.at === "number" && cut.around === undefined;
}

function canCrosscut(part: NonNullable<ReturnType<typeof getCatalogPart>>): boolean {
  const geometry = stockGeometry(part);
  return geometry === "box" || geometry === "rod";
}

function writeMemberSize(doc: Document, memberIndex: number, size: number[] | undefined): void {
  const path = ["members", memberIndex, "size"] as Array<string | number>;
  if (!size || size.length === 0) {
    if (doc.getIn(path) !== undefined) doc.deleteIn(path);
    return;
  }
  const node = doc.createNode(size.map((value) => roundInches(value)));
  if (isSeq(node)) node.flow = true;
  doc.setIn(path, node);
}

function writeMemberCuts(doc: Document, memberIndex: number, cuts: MemberCutInput[]): void {
  const path = ["members", memberIndex, "cuts"] as Array<string | number>;
  if (cuts.length === 0) {
    if (doc.getIn(path) !== undefined) doc.deleteIn(path);
    return;
  }
  const node = doc.createNode(cuts);
  if (isSeq(node)) {
    for (const child of node.items) {
      if (isMap(child)) child.flow = true;
    }
  }
  doc.setIn(path, node);
}

const YAML_CUTS = "Edit cuts in YAML to change this dimension.";

/**
 * Set one finished dimension (0 = L, 1 = W, 2 = T).
 * Uncut parameterized stock writes a size override. Uncut fixed lumber or sheet
 * goods write a square crosscut. When cuts exist, every cut on this axis must be
 * square: a start cut anchors the near end while the end cut moves, is added, or
 * is removed at full stock. Cuts on other axes are left alone.
 */
export function setMemberDimension(
  text: string,
  memberId: string,
  axis: 0 | 1 | 2,
  inches: number,
): string {
  if (!Number.isFinite(inches) || inches <= 0) {
    throw new EditError("Dimension must be greater than 0.");
  }
  const doc = parseEditDocument(text);
  const { members } = identified(doc);
  const memberIndex = members.findIndex((member) => member.id === memberId);
  if (memberIndex < 0) throw new EditError(`Unknown member "${memberId}"`);

  const raw = memberRecord(doc, memberIndex);
  const part = getCatalogPart(raw.stock);
  if (!part) throw new EditError(`Unknown stock "${raw.stock}"`);
  if (raw.cuts === null) throw new EditError(YAML_CUTS);

  let stockSize: Vec3;
  try {
    stockSize = resolveStockSize(part, raw.size).size;
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error));
  }

  const axisName = DIMENSION_AXIS[axis];
  const free = freeAxes(part);
  const cuttable = canCrosscut(part);
  const longer = `${axisName} cannot be longer than stock (${formatInches(stockSize[axis])}).`;

  if (raw.cuts.length === 0 && free.some((spec) => axisIndex(spec.axis) === axis)) {
    const values: Partial<Record<AxisName, number>> = {};
    for (const spec of free) {
      const index = axisIndex(spec.axis);
      values[spec.axis] = index === axis ? inches : stockSize[index];
    }
    if (free.every((spec) => nearly(values[spec.axis] ?? spec.default, stockSize[axisIndex(spec.axis)]))) {
      return text;
    }
    try {
      resolveStockSize(
        part,
        free.map((spec) => values[spec.axis] ?? spec.default),
      );
    } catch (error) {
      throw new EditError(error instanceof Error ? error.message : String(error));
    }
    writeMemberSize(doc, memberIndex, sizeOverride(part, values));
    return stringifyDocument(doc);
  }

  if (raw.cuts.length === 0) {
    if (!cuttable) throw new EditError(`${axisName} is fixed on this stock.`);
    if (inches > stockSize[axis] + 1e-6) throw new EditError(longer);
    if (nearly(inches, stockSize[axis])) return text;
    writeMemberCuts(doc, memberIndex, [{ axis, angle: 90, at: roundInches(inches) }]);
    return stringifyDocument(doc);
  }

  // Cuts exist. Cuts on other axes are left alone; every cut on this axis must
  // be square so the finished dimension stays unambiguous.
  if (!cuttable || free.some((spec) => axisIndex(spec.axis) === axis)) {
    throw new EditError(YAML_CUTS);
  }
  const limit = stockSize[axis];
  if (inches > limit + 1e-6) throw new EditError(longer);
  const stored = raw.cuts;

  type Located = { cut: StoredCut & { at: number }; index: number };
  let start: Located | undefined;
  let end: Located | undefined;
  for (const [index, cut] of stored.entries()) {
    if (cut.axis !== axis) continue;
    if (!isSquareCut(cut)) throw new EditError(YAML_CUTS);
    if ((cut.side ?? "end") === "start") {
      if (start) throw new EditError(YAML_CUTS);
      start = { cut, index };
    } else {
      if (end) throw new EditError(YAML_CUTS);
      end = { cut, index };
    }
  }

  const anchor = start ? start.cut.at : 0;
  const finished = (end ? end.cut.at : limit) - anchor;
  if (nearly(inches, finished)) return text;

  const cutsPath = ["members", memberIndex, "cuts"] as Array<string | number>;
  const without = (drop: Located): MemberCutInput[] =>
    stored.filter((_, index) => index !== drop.index).map(cutInput);
  const moveTo = (target: Located, at: number): string => {
    const rounded = roundInches(at);
    if (!(rounded > 1e-6) || rounded >= limit - 1e-6) throw new EditError(YAML_CUTS);
    doc.setIn([...cutsPath, target.index, "at"], rounded);
    return stringifyDocument(doc);
  };

  // No cut on this axis yet: add an end cut, keeping the cuts on other axes.
  if (!start && !end) {
    writeMemberCuts(doc, memberIndex, [...stored.map(cutInput), { axis, angle: 90, at: roundInches(inches) }]);
    return stringifyDocument(doc);
  }

  // A start cut anchors the near end, so the end cut moves to make the dimension.
  if (start && end) {
    const at = anchor + inches;
    if (at > limit + 1e-6) {
      throw new EditError(`${axisName} cannot be longer than the remaining stock (${formatInches(limit - anchor)}).`);
    }
    if (nearly(at, limit)) {
      writeMemberCuts(doc, memberIndex, without(end));
      return stringifyDocument(doc);
    }
    return moveTo(end, at);
  }

  if (end) {
    if (inches >= limit - 1e-6) {
      writeMemberCuts(doc, memberIndex, without(end));
      return stringifyDocument(doc);
    }
    return moveTo(end, inches);
  }

  if (start) {
    if (inches >= limit - 1e-6) {
      writeMemberCuts(doc, memberIndex, without(start));
      return stringifyDocument(doc);
    }
    return moveTo(start, limit - inches);
  }

  throw new EditError(YAML_CUTS);
}

const AXIS_LABEL = ["Length", "Width", "Thickness"] as const;

function cutInput(cut: MemberCutInput): MemberCutInput {
  const at = Array.isArray(cut.at) ? ([cut.at[0], cut.at[1]] as [number, number]) : cut.at;
  const next: MemberCutInput = { axis: cut.axis, angle: cut.angle, at };
  if (cut.side) next.side = cut.side;
  if (cut.around !== undefined) next.around = cut.around;
  return next;
}

function sameAt(a: number | [number, number], b: number | [number, number]): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return typeof a === "number" && typeof b === "number" && nearly(a, b);
  }
  return nearly(a[0], b[0]) && nearly(a[1], b[1]);
}

function sameCutList(a: readonly MemberCutInput[], b: readonly MemberCutInput[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((cut, index) => {
    const other = b[index];
    if (!other) return false;
    return (
      cut.axis === other.axis &&
      nearly(cut.angle, other.angle) &&
      sameAt(cut.at, other.at) &&
      (cut.side ?? "end") === (other.side ?? "end") &&
      cut.around === other.around
    );
  });
}

function sameSize(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => nearly(value, b[index] ?? NaN));
}

export type MemberResize =
  | { kind: "size"; size: number[] | undefined }
  | { kind: "cuts"; cuts: MemberCutInput[]; shift: number };

const STOCK_EPS = 1e-6;

/**
 * Spend leftover stock on the opposite cut so `inches` can sit outside `[0, limit]`.
 * `shift` is inches along `axis` added to each placement, keeping the other face put.
 * `null` when this drag is inside the stock, or the other end has no leftover length.
 */
function absorbStockOverflow(
  cuts: readonly MemberCutInput[],
  axis: 0 | 1 | 2,
  limit: number,
  inches: number,
  side: "start" | "end" | undefined,
): { cuts: MemberCutInput[]; shift: number } | null {
  const square = cuts.filter((cut): cut is MemberCutInput & { at: number } => cut.axis === axis && isSquareCut(cut));
  const end = square.find((cut) => (cut.side ?? "end") !== "start");
  const start = square.find((cut) => cut.side === "start");
  const target = side === "start" ? start : side === "end" ? end : (end ?? start);
  const face: "start" | "end" =
    side ?? (target ? ((target.side ?? "end") === "start" ? "start" : "end") : "end");
  const lo = start ? start.at : 0;
  const hi = end ? end.at : limit;
  const leaving =
    (face === "start" && inches < -STOCK_EPS) || (face === "end" && inches > limit + STOCK_EPS);
  if (!leaving) return null;

  let newLo = face === "start" ? inches : lo;
  let newHi = face === "end" ? inches : hi;
  let shift = 0;
  if (face === "start") {
    const overflow = -inches;
    if (overflow > limit - hi + STOCK_EPS) return null;
    newLo = 0;
    newHi = hi + overflow;
    shift = inches;
  } else {
    const overflow = inches - limit;
    if (overflow > lo + STOCK_EPS) return null;
    newHi = limit;
    newLo = lo - overflow;
    shift = overflow;
  }

  const wantStart = newLo > STOCK_EPS;
  const wantEnd = newHi < limit - STOCK_EPS;
  const next: MemberCutInput[] = [];
  let wroteStart = false;
  let wroteEnd = false;
  for (const cut of cuts) {
    if (start && cut === start) {
      if (wantStart) {
        const kept = cutInput(cut);
        kept.at = roundInches(newLo);
        kept.side = "start";
        next.push(kept);
        wroteStart = true;
      }
      continue;
    }
    if (end && cut === end) {
      if (wantEnd) {
        const kept = cutInput(cut);
        kept.at = roundInches(newHi);
        next.push(kept);
        wroteEnd = true;
      }
      continue;
    }
    next.push(cutInput(cut));
  }
  if (wantStart && !wroteStart) {
    next.push({ axis, angle: 90, at: roundInches(newLo), side: "start" });
  }
  if (wantEnd && !wroteEnd) {
    next.push({ axis, angle: 90, at: roundInches(newHi) });
  }
  return { cuts: next, shift };
}

/**
 * Next size override or cut list for a resize drag.
 * `inches` is the face coordinate in the drag-start frame (0 at the stock origin),
 * or the new free-axis length. `side` picks which face moves: "end" is the far face,
 * "start" the near one. Omitted keeps the existing far face, or the near face when
 * only that one is cut. `shift` slides the placement when the dragged face leaves
 * the stock and the opposite cut grows to match.
 */
export function draftMemberResize(
  part: NonNullable<ReturnType<typeof getCatalogPart>>,
  stockSize: Vec3,
  cuts: readonly MemberCutInput[],
  axis: 0 | 1 | 2,
  inches: number,
  side?: "start" | "end",
): MemberResize {
  if (!Number.isFinite(inches)) throw new EditError("Dimension must be a finite length.");
  const label = AXIS_LABEL[axis];
  const limit = stockSize[axis];
  const free = freeAxes(part);
  const freeSpec = free.find((spec) => axisIndex(spec.axis) === axis);
  const onAxis = cuts.filter((cut) => cut.axis === axis);
  if (onAxis.some((cut) => !isSquareCut(cut))) throw new EditError(YAML_CUTS);

  if (cuts.length === 0 && freeSpec) {
    const span = side === "start" ? limit - inches : inches;
    if (span < freeSpec.min - 1e-6 || span > freeSpec.max + 1e-6) {
      throw new EditError(
        `${label} must be between ${formatInches(freeSpec.min)} and ${formatInches(freeSpec.max)}.`,
      );
    }
    const values: Partial<Record<AxisName, number>> = {};
    for (const spec of free) {
      const index = axisIndex(spec.axis);
      values[spec.axis] = index === axis ? span : stockSize[index];
    }
    try {
      resolveStockSize(
        part,
        free.map((spec) => values[spec.axis] ?? spec.default),
      );
    } catch (error) {
      throw new EditError(error instanceof Error ? error.message : String(error));
    }
    return { kind: "size", size: sizeOverride(part, values) };
  }

  if (!canCrosscut(part)) {
    throw new EditError(freeSpec ? `${label} cannot be cut on this stock.` : `${label} is fixed on this stock.`);
  }
  const absorbed = absorbStockOverflow(cuts, axis, limit, inches, side);
  if (absorbed) return { kind: "cuts", cuts: absorbed.cuts, shift: absorbed.shift };
  if (inches > limit + STOCK_EPS || inches < -STOCK_EPS) {
    throw new EditError(`${label} cannot extend past the stock (${formatInches(inches < 0 ? 0 : limit)}).`);
  }

  const square = onAxis.filter(isSquareCut);
  const end = square.find((cut) => (cut.side ?? "end") !== "start");
  const start = square.find((cut) => cut.side === "start");
  const target = side === "start" ? start : side === "end" ? end : (end ?? start);
  const face: "start" | "end" =
    side ?? (target ? ((target.side ?? "end") === "start" ? "start" : "end") : "end");

  const without = (drop: MemberCutInput): MemberCutInput[] => {
    let skipped = false;
    const next: MemberCutInput[] = [];
    for (const cut of cuts) {
      if (!skipped && cut === drop) {
        skipped = true;
        continue;
      }
      next.push(cutInput(cut));
    }
    return next;
  };

  const gone = `That cut would remove the whole ${label.toLowerCase()}.`;
  const atRest = face === "start" ? inches <= 1e-6 : inches >= limit - 1e-6;
  const removesWhole = face === "start" ? inches >= limit - 1e-6 : !(inches > 1e-6);
  const crosses =
    face === "start" ? Boolean(end && inches >= end.at - 1e-6) : Boolean(start && inches <= start.at + 1e-6);

  if (!target) {
    if (atRest) return { kind: "cuts", cuts: cuts.map(cutInput), shift: 0 };
    if (removesWhole || crosses) throw new EditError(gone);
    const added: MemberCutInput = { axis, angle: 90, at: roundInches(inches) };
    if (face === "start") added.side = "start";
    return { kind: "cuts", cuts: [...cuts.map(cutInput), added], shift: 0 };
  }

  if (atRest) return { kind: "cuts", cuts: without(target), shift: 0 };
  if (removesWhole || crosses) throw new EditError(gone);

  return {
    kind: "cuts",
    shift: 0,
    cuts: cuts.map((cut) => {
      if (cut !== target) return cutInput(cut);
      const next = cutInput(cut);
      next.at = roundInches(inches);
      return next;
    }),
  };
}

/** Move the square cut on `axis`, or add one. Parameterized stock with no cuts changes size. */
export function resizeMemberCut(
  text: string,
  memberId: string,
  axis: 0 | 1 | 2,
  inches: number,
  side?: "start" | "end",
): string {
  const doc = parseEditDocument(text);
  const { members } = identified(doc);
  const memberIndex = members.findIndex((member) => member.id === memberId);
  if (memberIndex < 0) throw new EditError(`Unknown member "${memberId}"`);

  const raw = memberRecord(doc, memberIndex);
  const part = getCatalogPart(raw.stock);
  if (!part) throw new EditError(`Unknown stock "${raw.stock}"`);
  if (raw.cuts === null) throw new EditError(YAML_CUTS);

  let stockSize: Vec3;
  try {
    stockSize = resolveStockSize(part, raw.size).size;
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error));
  }

  const drafted = draftMemberResize(part, stockSize, raw.cuts, axis, inches, side);
  if (drafted.kind === "size") {
    if (sameSize(raw.size, drafted.size)) return text;
    writeMemberSize(doc, memberIndex, drafted.size);
    return stringifyDocument(doc);
  }
  const cutsSame = sameCutList(raw.cuts, drafted.cuts);
  if (cutsSame && nearly(drafted.shift, 0)) return text;
  if (!cutsSame) writeMemberCuts(doc, memberIndex, drafted.cuts);
  if (!nearly(drafted.shift, 0)) {
    shiftMemberPlacements(doc, memberId, axis, drafted.shift);
    shiftMemberBores(doc, memberIndex, axis, drafted.shift);
  }
  return stringifyDocument(doc);
}

function readVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return [asInches(value[0], "Vector"), asInches(value[1], "Vector"), asInches(value[2], "Vector")];
}

function placementPose(doc: Document, path: Array<string | number>): { position: Vec3; rotation: Vec3 } {
  const node = doc.getIn(path);
  const value = isMap(node) ? node.toJS(doc) : {};
  const record = (value ?? {}) as { position?: unknown; rotation?: unknown };
  return {
    position: readVec3(record.position) ?? [0, 0, 0],
    rotation: readVec3(record.rotation) ?? [0, 0, 0],
  };
}

/** Slide every placement of `memberId` by `shift` inches along the member's `axis`. */
function shiftMemberPlacements(doc: Document, memberId: string, axis: 0 | 1 | 2, shift: number): void {
  const local: Vec3 = [0, 0, 0];
  local[axisCoord(axis)] = shift;
  const componentCount = seqLength(doc, ["components"]);
  for (let cIndex = 0; cIndex < componentCount; cIndex++) {
    const membersPath = ["components", cIndex, "members"] as Array<string | number>;
    const count = seqLength(doc, membersPath);
    for (let pIndex = 0; pIndex < count; pIndex++) {
      const base = [...membersPath, pIndex];
      if (doc.getIn([...base, "id"]) !== memberId) continue;
      const pose = placementPose(doc, base);
      setVec3(doc, [...base, "position"], add(pose.position, rotateEulerXYZ(local, pose.rotation)), 4);
    }
  }
}

/** Keep bore centers with the face that did not move. `shift` is the placement slide along `axis`. */
function shiftMemberBores(doc: Document, memberIndex: number, axis: 0 | 1 | 2, shift: number): void {
  const path = ["members", memberIndex, "bores"] as Array<string | number>;
  const count = seqLength(doc, path);
  for (let index = 0; index < count; index++) {
    const face = doc.getIn([...path, index, "face"]);
    if (typeof face !== "string" || !isFaceId(face)) continue;
    const axes = faceFrame(face, [0, 0, 0]).axes;
    const atIndex = axes[0] === axis ? 0 : axes[1] === axis ? 1 : -1;
    if (atIndex < 0) continue;
    const atPath = [...path, index, "at", atIndex];
    doc.setIn(atPath, roundInches(asInches(doc.getIn(atPath), "Bore at") - shift));
  }
}

/** Clone a member definition and place the copy in the same component. Returns the new id. */
function placeMemberCopy(
  doc: Document,
  memberId: string,
  componentId: string,
  position: Vec3,
  rotation: Vec3,
): string {
  pinAssignedIds(doc);
  const { members } = identified(doc);
  const memberIndex = members.findIndex((member) => member.id === memberId);
  if (memberIndex < 0) throw new EditError(`Unknown member "${memberId}"`);
  const previous = new Set(members.map((member) => member.id));

  const node = doc.getIn(["members", memberIndex]);
  if (!isMap(node)) throw new EditError("Member is missing");
  const copy = node.clone();
  if (!isMap(copy)) throw new EditError("Could not copy the member");
  copy.anchor = undefined;
  for (let index = copy.items.length - 1; index >= 0; index -= 1) {
    const item = copy.items[index];
    if (isPair(item) && isScalar(item.key) && item.key.value === "id") {
      copy.items.splice(index, 1);
    }
  }

  ensureSeq(doc, ["members"]);
  const nextMemberIndex = seqLength(doc, ["members"]);
  doc.setIn(["members", nextMemberIndex], copy);

  const created = identified(doc).members.find((member) => !previous.has(member.id));
  if (!created) throw new EditError("Could not assign a member id");

  const cIndex = componentIndex(doc, componentId);
  ensureSeq(doc, ["components", cIndex, "members"]);
  const placementIndex = seqLength(doc, ["components", cIndex, "members"]);
  doc.setIn(
    ["components", cIndex, "members", placementIndex],
    placementNode(doc, created.id, position, rotation),
  );
  return created.id;
}

/** Clone a member definition and place the copy in the same component. */
export function duplicateMember(
  text: string,
  memberId: string,
  componentId: string,
  position: Vec3,
  rotation: Vec3,
): string {
  const doc = parseEditDocument(text);
  placeMemberCopy(doc, memberId, componentId, position, rotation);
  return stringifyDocument(doc);
}

export type DuplicateMember = {
  memberId: string;
  componentId: string;
  /** 0-based occurrence of this member id in the component. */
  occurrence: number;
  position: Vec3;
  rotation: Vec3;
};

function instanceRefKey(componentId: string, memberId: string, occurrence: number): string {
  return `${componentId}/${memberId}#${occurrence}`;
}

type JointRef = {
  componentId: string;
  memberId: string;
  occurrence: number;
};

function readJointMembers(
  doc: Document,
  membersPath: Array<string | number>,
  impliedComponentId: string | null,
): JointRef[] | null {
  const count = seqLength(doc, membersPath);
  if (count < 2) return null;
  const refs: JointRef[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = doc.getIn([...membersPath, index, "id"]);
    if (typeof id !== "string") return null;
    const componentField = doc.getIn([...membersPath, index, "component"]);
    const componentId = impliedComponentId ?? (typeof componentField === "string" ? componentField : null);
    if (!componentId) return null;
    const rawIndex = doc.getIn([...membersPath, index, "index"]);
    const occurrence =
      typeof rawIndex === "number" && Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
    refs.push({ componentId, memberId: id, occurrence });
  }
  return refs;
}

function retargetJoint(
  doc: Document,
  entryPath: Array<string | number>,
  refs: JointRef[],
  idMap: Map<string, string>,
  isConnection: boolean,
): void {
  const membersPath = [...entryPath, "members"];
  for (let index = 0; index < refs.length; index += 1) {
    const nextId = idMap.get(instanceRefKey(refs[index].componentId, refs[index].memberId, refs[index].occurrence));
    if (!nextId) continue;
    doc.setIn([...membersPath, index, "id"], nextId);
    const indexPath = [...membersPath, index, "index"];
    if (doc.getIn(indexPath) !== undefined) doc.deleteIn(indexPath);
  }
  if (!isConnection) return;
  const fastenersPath = [...entryPath, "fasteners"];
  const fastenerCount = seqLength(doc, fastenersPath);
  for (let index = 0; index < fastenerCount; index += 1) {
    const bracketPath = [...fastenersPath, index, "variant", "bracket"];
    const bracket = doc.getIn(bracketPath);
    if (typeof bracket !== "string") continue;
    const match = refs.find((ref) => ref.memberId === bracket);
    const nextId = match
      ? idMap.get(instanceRefKey(match.componentId, match.memberId, match.occurrence))
      : undefined;
    if (nextId) doc.setIn(bracketPath, nextId);
  }
}

/** Append clones of joints whose every member is in `idMap`. */
function copyInternalJoints(doc: Document, idMap: Map<string, string>): void {
  const { components } = identified(doc);
  const lists: Array<{ path: Array<string | number>; componentId: string | null; isConnection: boolean }> = [];
  for (let index = 0; index < components.length; index += 1) {
    lists.push({ path: ["components", index, "connections"], componentId: components[index].id, isConnection: true });
    lists.push({ path: ["components", index, "fasteners"], componentId: components[index].id, isConnection: false });
  }
  lists.push({ path: ["connections"], componentId: null, isConnection: true });
  lists.push({ path: ["fasteners"], componentId: null, isConnection: false });

  for (const list of lists) {
    const count = seqLength(doc, list.path);
    for (let index = 0; index < count; index += 1) {
      const refs = readJointMembers(doc, [...list.path, index, "members"], list.componentId);
      if (!refs || !refs.every((ref) => idMap.has(instanceRefKey(ref.componentId, ref.memberId, ref.occurrence)))) {
        continue;
      }
      const node = doc.getIn([...list.path, index]);
      if (!isMap(node)) continue;
      const copy = node.clone();
      if (!isMap(copy)) continue;
      copy.anchor = undefined;
      const next = seqLength(doc, list.path);
      doc.setIn([...list.path, next], copy);
      retargetJoint(doc, [...list.path, next], refs, idMap, list.isConnection);
    }
  }
}

/**
 * Clone each member and place it. Connections and explicit fasteners whose members
 * are all in this set are cloned onto the new ids. A joint that also names a
 * member outside the set stays with the originals.
 */
export function duplicateMembers(text: string, items: DuplicateMember[]): string {
  if (items.length === 0) return text;
  const doc = parseEditDocument(text);
  const idMap = new Map<string, string>();
  for (const item of items) {
    const newId = placeMemberCopy(doc, item.memberId, item.componentId, item.position, item.rotation);
    idMap.set(instanceRefKey(item.componentId, item.memberId, item.occurrence), newId);
  }
  copyInternalJoints(doc, idMap);
  return stringifyDocument(doc);
}

export type GroupPlacement = {
  componentId: string;
  /** Index in that component's members array. */
  placementIndex: number;
  position: Vec3;
  rotation: Vec3;
};

export type GroupMembersResult = {
  text: string;
  componentId: string;
};

type PlacementSlot = {
  componentId: string;
  placementIndex: number;
  memberId: string;
  occurrence: number;
  moved: GroupPlacement | null;
};

type MemberDest = {
  componentId: string;
  occurrence: number;
};

function placementSlotKey(componentId: string, placementIndex: number): string {
  return `${componentId}#${placementIndex}`;
}

function writeMemberRef(
  doc: Document,
  memberPath: Array<string | number>,
  dest: MemberDest,
  place: "component" | "document",
): void {
  const componentPath = [...memberPath, "component"];
  if (place === "component") {
    if (doc.getIn(componentPath) !== undefined) doc.deleteIn(componentPath);
  } else if (doc.getIn(componentPath) !== dest.componentId) {
    doc.setIn(componentPath, dest.componentId);
  }
  const indexPath = [...memberPath, "index"];
  const current = doc.getIn(indexPath);
  if (dest.occurrence === 0) {
    if (current !== undefined) doc.deleteIn(indexPath);
  } else if (current !== dest.occurrence) {
    doc.setIn(indexPath, dest.occurrence);
  }
}

function groupComponentNode(
  doc: Document,
  id: string,
  origin: Vec3,
  placements: Array<{ memberId: string; position: Vec3; rotation: Vec3 }>,
) {
  const node = doc.createNode({
    id,
    label: "Group",
    position: roundVec(origin, 4),
    rotation: [0, 0, 0],
    members: placements.map((placement) => ({
      id: placement.memberId,
      position: roundVec(placement.position, 4),
      rotation: roundVec(placement.rotation, 1),
    })),
  });
  flowSequences(node, new Set(["position", "rotation"]));
  if (isMap(node)) {
    const membersPair = node.items.find((item) => isScalar(item.key) && item.key.value === "members");
    if (membersPair && isSeq(membersPair.value)) {
      for (const placement of membersPair.value.items) {
        if (isMap(placement)) placement.flow = true;
      }
    }
  }
  return node;
}

/**
 * Move placements into one component whose origin is `origin`.
 * When `reseatComponentId` is set, that component keeps its rotation and only its origin moves.
 * Otherwise the placements are removed from their sources and appended to a new Group
 * with no rotation. Joints whose members are all in the set move onto that group.
 * A joint that also names a member left behind becomes document-level.
 */
export function groupMembers(
  text: string,
  items: GroupPlacement[],
  origin: Vec3,
  reseatComponentId?: string,
): GroupMembersResult {
  if (items.length === 0) throw new EditError("Select at least one member to group");
  const doc = parseEditDocument(text);
  pinAssignedIds(doc);
  const { members, components } = identified(doc);
  const componentIndexById = new Map(components.map((component, index) => [component.id, index]));

  const seenItems = new Set<string>();
  for (const item of items) {
    const key = placementSlotKey(item.componentId, item.placementIndex);
    if (seenItems.has(key)) {
      throw new EditError(`Placement ${item.placementIndex} in "${item.componentId}" is listed twice`);
    }
    seenItems.add(key);
  }

  const slotsByComponent = new Map<string, PlacementSlot[]>();
  const slotByKey = new Map<string, PlacementSlot>();
  for (const component of components) {
    const cIndex = componentIndexById.get(component.id);
    if (cIndex === undefined) continue;
    const count = seqLength(doc, ["components", cIndex, "members"]);
    const seen = new Map<string, number>();
    const slots: PlacementSlot[] = [];
    for (let placementIndex = 0; placementIndex < count; placementIndex += 1) {
      const memberId = doc.getIn(["components", cIndex, "members", placementIndex, "id"]);
      if (typeof memberId !== "string" || memberId.length === 0) {
        throw new EditError(`Placement ${placementIndex} in "${component.id}" is missing an id`);
      }
      const occurrence = seen.get(memberId) ?? 0;
      seen.set(memberId, occurrence + 1);
      const slot: PlacementSlot = {
        componentId: component.id,
        placementIndex,
        memberId,
        occurrence,
        moved: null,
      };
      slots.push(slot);
      slotByKey.set(placementSlotKey(component.id, placementIndex), slot);
    }
    slotsByComponent.set(component.id, slots);
  }

  for (const item of items) {
    const slot = slotByKey.get(placementSlotKey(item.componentId, item.placementIndex));
    if (!slot) {
      throw new EditError(
        `Placement index ${item.placementIndex} is out of range in component "${item.componentId}"`,
      );
    }
    slot.moved = item;
  }

  if (reseatComponentId) {
    if (!componentIndexById.has(reseatComponentId)) {
      throw new EditError(`Unknown component "${reseatComponentId}"`);
    }
    for (const item of items) {
      if (item.componentId !== reseatComponentId) {
        throw new EditError(`Placement in "${item.componentId}" is not part of "${reseatComponentId}"`);
      }
    }
    const cIndex = componentIndexById.get(reseatComponentId)!;
    setVec3(doc, ["components", cIndex, "position"], origin, 4);
    for (const item of items) {
      setVec3(doc, ["components", cIndex, "members", item.placementIndex, "position"], item.position, 4);
    }
    return { text: stringifyDocument(doc), componentId: reseatComponentId };
  }

  const movedNew = new Map<string, number>();
  const nextMoved = new Map<string, number>();
  for (const item of items) {
    const slot = slotByKey.get(placementSlotKey(item.componentId, item.placementIndex))!;
    const key = instanceRefKey(slot.componentId, slot.memberId, slot.occurrence);
    const occurrence = nextMoved.get(slot.memberId) ?? 0;
    nextMoved.set(slot.memberId, occurrence + 1);
    movedNew.set(key, occurrence);
  }

  const stayedNew = new Map<string, number>();
  for (const slots of slotsByComponent.values()) {
    const next = new Map<string, number>();
    for (const slot of slots) {
      if (slot.moved) continue;
      const occurrence = next.get(slot.memberId) ?? 0;
      next.set(slot.memberId, occurrence + 1);
      stayedNew.set(instanceRefKey(slot.componentId, slot.memberId, slot.occurrence), occurrence);
    }
  }

  const removedComponentIds = new Set<string>();
  for (const [componentId, slots] of slotsByComponent) {
    if (slots.length > 0 && slots.every((slot) => slot.moved)) removedComponentIds.add(componentId);
  }

  let newComponentId = "";
  try {
    const preview = assignIds([
      ...members.map((member) => ({ label: member.label, id: member.id })),
      ...components
        .filter((component) => !removedComponentIds.has(component.id))
        .map((component) => ({ label: component.label, id: component.id })),
      { label: "Group" },
    ]);
    newComponentId = preview[preview.length - 1]?.id ?? "";
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error));
  }
  if (!newComponentId) throw new EditError("Could not assign a component id");

  const destOf = (ref: JointRef): MemberDest => {
    const key = instanceRefKey(ref.componentId, ref.memberId, ref.occurrence);
    if (movedNew.has(key)) return { componentId: newComponentId, occurrence: movedNew.get(key)! };
    return { componentId: ref.componentId, occurrence: stayedNew.get(key) ?? ref.occurrence };
  };

  type LocatedJoint = {
    listPath: Array<string | number>;
    index: number;
    impliedComponentId: string | null;
    refs: JointRef[];
  };
  const ontoGroup: LocatedJoint[] = [];
  const ontoDocument: LocatedJoint[] = [];
  const updateInPlace: LocatedJoint[] = [];

  const lists: Array<{ path: Array<string | number>; impliedComponentId: string | null }> = [];
  for (let index = 0; index < components.length; index += 1) {
    lists.push({ path: ["components", index, "connections"], impliedComponentId: components[index].id });
    lists.push({ path: ["components", index, "fasteners"], impliedComponentId: components[index].id });
  }
  lists.push({ path: ["connections"], impliedComponentId: null });
  lists.push({ path: ["fasteners"], impliedComponentId: null });

  for (const list of lists) {
    const count = seqLength(doc, list.path);
    for (let index = 0; index < count; index += 1) {
      const refs = readJointMembers(doc, [...list.path, index, "members"], list.impliedComponentId);
      if (!refs) continue;
      const keys = refs.map((ref) => instanceRefKey(ref.componentId, ref.memberId, ref.occurrence));
      if (!keys.every((key) => movedNew.has(key) || stayedNew.has(key))) continue;
      const located: LocatedJoint = {
        listPath: list.path,
        index,
        impliedComponentId: list.impliedComponentId,
        refs,
      };
      if (keys.every((key) => movedNew.has(key))) ontoGroup.push(located);
      else if (keys.some((key) => movedNew.has(key)) && list.impliedComponentId) ontoDocument.push(located);
      else updateInPlace.push(located);
    }
  }

  for (const joint of updateInPlace) {
    const place = joint.impliedComponentId ? "component" : "document";
    for (let index = 0; index < joint.refs.length; index += 1) {
      writeMemberRef(doc, [...joint.listPath, joint.index, "members", index], destOf(joint.refs[index]), place);
    }
  }

  const clones = [...ontoGroup, ...ontoDocument].flatMap((joint) => {
    const node = doc.getIn([...joint.listPath, joint.index]);
    if (!isMap(node)) return [];
    const copy = node.clone();
    if (!isMap(copy)) return [];
    copy.anchor = undefined;
    return [{ joint, copy }];
  });

  const removeAt = new Map<string, { path: Array<string | number>; indices: number[] }>();
  for (const joint of [...ontoGroup, ...ontoDocument]) {
    const key = JSON.stringify(joint.listPath);
    const entry = removeAt.get(key);
    if (entry) entry.indices.push(joint.index);
    else removeAt.set(key, { path: joint.listPath, indices: [joint.index] });
  }
  for (const entry of removeAt.values()) {
    entry.indices.sort((left, right) => right - left);
    for (const index of entry.indices) doc.deleteIn([...entry.path, index]);
  }

  for (const [componentId, slots] of slotsByComponent) {
    const cIndex = componentIndexById.get(componentId);
    if (cIndex === undefined) continue;
    const indices = slots
      .filter((slot) => slot.moved)
      .map((slot) => slot.placementIndex)
      .sort((left, right) => right - left);
    for (const placementIndex of indices) {
      doc.deleteIn(["components", cIndex, "members", placementIndex]);
    }
  }

  for (let cIndex = components.length - 1; cIndex >= 0; cIndex -= 1) {
    if (removedComponentIds.has(components[cIndex].id)) doc.deleteIn(["components", cIndex]);
  }

  ensureSeq(doc, ["components"]);
  const createdIndex = seqLength(doc, ["components"]);
  const placements = items.map((item) => {
    const slot = slotByKey.get(placementSlotKey(item.componentId, item.placementIndex))!;
    return { memberId: slot.memberId, position: item.position, rotation: item.rotation };
  });
  doc.setIn(["components", createdIndex], groupComponentNode(doc, newComponentId, origin, placements));

  const appendJoint = (
    entry: { joint: LocatedJoint; copy: ReturnType<Document["createNode"]> },
    listPath: Array<string | number>,
    place: "component" | "document",
  ) => {
    if (!isMap(entry.copy)) return;
    ensureSeq(doc, listPath);
    const index = seqLength(doc, listPath);
    doc.setIn([...listPath, index], entry.copy);
    for (let member = 0; member < entry.joint.refs.length; member += 1) {
      writeMemberRef(doc, [...listPath, index, "members", member], destOf(entry.joint.refs[member]), place);
    }
  };

  for (const entry of clones) {
    if (ontoGroup.includes(entry.joint)) {
      const listName = entry.joint.listPath[entry.joint.listPath.length - 1] === "fasteners" ? "fasteners" : "connections";
      appendJoint(entry, ["components", createdIndex, listName], "component");
    } else {
      const listName = entry.joint.listPath[entry.joint.listPath.length - 1] === "fasteners" ? "fasteners" : "connections";
      appendJoint(entry, [listName], "document");
    }
  }

  return { text: stringifyDocument(doc), componentId: newComponentId };
}
