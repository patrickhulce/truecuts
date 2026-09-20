import { isSeq, parseDocument, type Document } from "yaml";
import { assignIds, type Labeled } from "./identity";
import type { Vec3 } from "./geometry";

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
  parts: (Labeled & { id: string })[];
  components: (Labeled & { id: string })[];
} {
  const data = doc.toJS() ?? {};
  const rawParts = Array.isArray(data.parts) ? data.parts : [];
  const rawComponents = Array.isArray(data.components) ? data.components : [];
  const labeledParts = rawParts.map((part: unknown, index: number) => asLabeled(part, `parts[${index}]`));
  const labeledComponents = rawComponents.map((component: unknown, index: number) =>
    asLabeled(component, `components[${index}]`),
  );
  try {
    const assigned = assignIds([...labeledParts, ...labeledComponents]);
    return {
      parts: assigned.slice(0, labeledParts.length),
      components: assigned.slice(labeledParts.length),
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

function stripMembers(doc: Document, membersPath: Array<string | number>, partId: string): void {
  const members = doc.getIn(membersPath);
  if (!isSeq(members)) return;
  for (let index = members.items.length - 1; index >= 0; index--) {
    const part = doc.getIn([...membersPath, index, "part"]);
    if (part === partId) {
      doc.deleteIn([...membersPath, index]);
    }
  }
}

function stripFastenerSeq(doc: Document, seqPath: Array<string | number>, partId: string): void {
  const seq = doc.getIn(seqPath);
  if (!isSeq(seq)) return;
  for (let index = seq.items.length - 1; index >= 0; index--) {
    const membersPath = [...seqPath, index, "members"];
    stripMembers(doc, membersPath, partId);
    if (seqLength(doc, membersPath) < 2) {
      doc.deleteIn([...seqPath, index]);
    }
  }
}

/**
 * Remove a part definition and every placement / fastener member that references it.
 * Fasteners left with fewer than two members are dropped.
 */
export function deletePart(text: string, partId: string): string {
  const doc = parseEditDocument(text);
  const { parts } = identified(doc);
  const partIndex = parts.findIndex((part) => part.id === partId);
  if (partIndex < 0) {
    throw new EditError(`Unknown part "${partId}"`);
  }

  const componentCount = seqLength(doc, ["components"]);
  for (let cIndex = 0; cIndex < componentCount; cIndex++) {
    const partsPath = ["components", cIndex, "parts"] as Array<string | number>;
    const placements = doc.getIn(partsPath);
    if (isSeq(placements)) {
      for (let pIndex = placements.items.length - 1; pIndex >= 0; pIndex--) {
        if (doc.getIn([...partsPath, pIndex, "part"]) === partId) {
          doc.deleteIn([...partsPath, pIndex]);
        }
      }
    }
    stripFastenerSeq(doc, ["components", cIndex, "fasteners"], partId);
  }
  stripFastenerSeq(doc, ["fasteners"], partId);
  doc.deleteIn(["parts", partIndex]);
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
  if (placementIndex < 0 || placementIndex >= seqLength(doc, ["components", cIndex, "parts"])) {
    throw new EditError(
      `Placement index ${placementIndex} is out of range in component "${componentId}"`,
    );
  }
  const base = ["components", cIndex, "parts", placementIndex] as Array<string | number>;
  setVec3(doc, [...base, "position"], position, 4);
  setVec3(doc, [...base, "rotation"], rotation, 1);
  return doc.toString(STRINGIFY);
}
