import { isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import { getCatalogPart, getFastenerSubtype, resolveStockSize, stockGeometry, type AxisName } from "./catalog";
import { freeAxes, sizeOverride } from "./catalog-families";
import { assignIds, type Labeled } from "./identity";
import type { Vec3 } from "./geometry";
import type { RawConnectionFastener } from "./schema";
import { formatInches, parseDimension } from "./units";

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
};

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

function placementNode(doc: Document, memberId: string) {
  const node = doc.createNode(
    { id: memberId, position: [0, 0, 0], rotation: [0, 0, 0] },
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
      members: [{ id: newId, position: [0, 0, 0], rotation: [0, 0, 0] }],
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
    ensureSeq(doc, ["components", 0, "members"]);
    const placementIndex = seqLength(doc, ["components", 0, "members"]);
    doc.setIn(["components", 0, "members", placementIndex], placementNode(doc, newId));
  }

  return doc.toString(STRINGIFY);
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
  return doc.toString(STRINGIFY);
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
  return doc.toString(STRINGIFY);
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
 * goods, and a member with a single square cut on this axis, write that crosscut.
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
    return doc.toString(STRINGIFY);
  }

  if (raw.cuts.length === 0) {
    if (!cuttable) throw new EditError(`${axisName} is fixed on this stock.`);
    if (inches > stockSize[axis] + 1e-6) throw new EditError(longer);
    if (nearly(inches, stockSize[axis])) return text;
    writeMemberCuts(doc, memberIndex, [{ axis, angle: 90, at: roundInches(inches) }]);
    return doc.toString(STRINGIFY);
  }

  const only = raw.cuts.length === 1 ? raw.cuts[0] : undefined;
  if (only && isSquareCut(only) && only.axis === axis && cuttable) {
    if (inches > stockSize[axis] + 1e-6) throw new EditError(longer);
    if (inches >= stockSize[axis] - 1e-6) {
      writeMemberCuts(doc, memberIndex, []);
      return doc.toString(STRINGIFY);
    }
    const at = (only.side ?? "end") === "start" ? stockSize[axis] - inches : inches;
    if (!(at > 1e-6) || at >= stockSize[axis] - 1e-6) throw new EditError(YAML_CUTS);
    doc.setIn(["members", memberIndex, "cuts", 0, "at"], roundInches(at));
    return doc.toString(STRINGIFY);
  }

  throw new EditError(YAML_CUTS);
}
