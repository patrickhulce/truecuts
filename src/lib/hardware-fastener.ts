import { getCatalogPart, isFixedAxis, listCatalog, stockGeometry, type CatalogPart } from "./catalog";
import type { FastenerIssue } from "./fasteners";
import {
  add,
  boundingBox,
  centroid3,
  cross,
  dot,
  hostForPatch,
  len,
  normalize,
  patchNormalFor,
  rotateEulerXYZ,
  scale,
  sub,
  worldPolyhedron,
  type Face,
  type Polyhedron,
  type SceneContacts,
  type SharedPatch,
  type Vec3,
} from "./geometry";
import { faceNormal } from "./geometry/solids";

/** A placed member the hardware seater can measure. */
export type SeatedMember = {
  key: string;
  faces: Polyhedron;
  position: Vec3;
  rotation: Vec3;
  componentPosition: Vec3;
  componentRotation: Vec3;
  stockSize: Vec3;
  stockId: string;
};

export type HardwareKind = "bracket" | "flat-bracket" | "saddle" | "hanger";

export type SeatedHardware = {
  origin: Vec3;
  across: Vec3;
  direction: Vec3;
  size: Vec3;
  /** Polyhedron-local point that sits on `origin`. */
  anchor: Vec3;
  riser?: number;
  face?: number;
  members: [string, string];
};

const UP: Vec3 = [0, 1, 0];
/** |dot| below this is a right angle, give or take. */
const PERP = 0.35;
/** |dot| above this is the same direction. */
const PARALLEL = 0.75;
const HIT_EPS = 1e-4;

const KIND_GEOMETRY = {
  bracket: "bracket-l",
  "flat-bracket": "bracket-flat-l",
  saddle: "saddle",
  hanger: "joist-hanger",
} as const;

const KIND_LABEL: Record<HardwareKind, string> = {
  bracket: "Angle bracket",
  "flat-bracket": "Flat bracket",
  saddle: "Saddle",
  hanger: "Joist hanger",
};

export function hardwareKindLabel(kind: HardwareKind): string {
  return KIND_LABEL[kind];
}

export function isHardwareKind(kind: string): kind is HardwareKind {
  return kind === "bracket" || kind === "flat-bracket" || kind === "saddle" || kind === "hanger";
}

function worldOf(solid: SeatedMember): Polyhedron {
  return worldPolyhedron(
    solid.faces,
    solid.position,
    solid.rotation,
    solid.componentPosition,
    solid.componentRotation,
  );
}

function dirToWorld(solid: SeatedMember, local: Vec3): Vec3 {
  return rotateEulerXYZ(rotateEulerXYZ(local, solid.rotation), solid.componentRotation);
}

function lengthAxis(solid: SeatedMember): Vec3 {
  return dirToWorld(solid, [1, 0, 0]);
}

function thicknessAxis(solid: SeatedMember): Vec3 {
  return dirToWorld(solid, [0, 1, 0]);
}

function widthAxis(solid: SeatedMember): Vec3 {
  return dirToWorld(solid, [0, 0, 1]);
}

function pointInConvexFace(point: Vec3, face: Face, normal: Vec3): boolean {
  const n = normalize(normal);
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const inward = cross(n, sub(b, a));
    if (dot(inward, sub(point, a)) < -1e-4) return false;
  }
  return true;
}

/** Distance from `origin` along `dir` to the next face of a solid. */
function rayFaceDistance(faces: Polyhedron, origin: Vec3, dir: Vec3): number {
  const direction = normalize(dir);
  if (len(direction) < 1e-8) return 0;
  const start = add(origin, scale(direction, 1e-3));
  let best = Infinity;
  for (const face of faces) {
    if (face.length < 3) continue;
    const normal = faceNormal(face);
    const denom = dot(normal, direction);
    if (Math.abs(denom) < 1e-8) continue;
    const t = (dot(normal, face[0]) - dot(normal, start)) / denom;
    if (t < HIT_EPS) continue;
    const point = add(start, scale(direction, t));
    if (!pointInConvexFace(point, face, normal)) continue;
    const fromOrigin = t + 1e-3;
    if (fromOrigin < best) best = fromOrigin;
  }
  return Number.isFinite(best) ? best : 0;
}

/** How far a convex face extends from `origin` along `dir`. */
function extentBeyond(polygon: Face, origin: Vec3, dir: Vec3): number {
  const direction = normalize(dir);
  if (len(direction) < 1e-8 || polygon.length < 2) return 0;
  let best = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const edge = sub(polygon[(i + 1) % polygon.length], a);
    const cr = cross(direction, edge);
    const denom = dot(cr, cr);
    if (denom < 1e-12) continue;
    const fromA = sub(a, origin);
    const t = dot(cross(fromA, edge), cr) / denom;
    const s = dot(cross(fromA, direction), cr) / denom;
    if (s < -1e-3 || s > 1 + 1e-3 || t < 1e-3) continue;
    if (t > best) best = t;
  }
  return best;
}

/**
 * How far `dir` can run from `point` and still be on this member.
 * A ray through the volume, or along a face when `dir` is tangent to it.
 */
function runInto(solid: SeatedMember, point: Vec3, dir: Vec3): number {
  const direction = normalize(dir);
  if (len(direction) < 1e-8) return 0;
  const nudge = 0.05;
  const through = rayFaceDistance(worldOf(solid), add(point, scale(direction, nudge)), direction);
  let best = through > 1e-3 ? through + nudge : 0;
  for (const face of worldOf(solid)) {
    if (face.length < 3) continue;
    const normal = faceNormal(face);
    if (Math.abs(dot(normal, direction)) > 0.25) continue;
    if (Math.abs(dot(sub(point, face[0]), normal)) > 0.08) continue;
    if (!pointInConvexFace(point, face, normal)) continue;
    best = Math.max(best, extentBeyond(face, point, direction));
  }
  return best;
}

function axisRange(part: CatalogPart, axis: "L" | "W"): { min: number; max: number; fixed: boolean } {
  const index = axis === "L" ? 0 : 1;
  const spec = part.axes?.[axis];
  if (!spec || isFixedAxis(spec)) return { min: part.size[index], max: part.size[index], fixed: true };
  return { min: spec.min, max: spec.max, fixed: false };
}

function defaultLeg(part: CatalogPart): number {
  const spec = part.axes?.L;
  if (spec && !isFixedAxis(spec)) return spec.default;
  return part.size[0];
}

function featureOf(part: CatalogPart, name: string, fallback: number): number {
  const spec = part.features?.[name];
  if (spec && "fixed" in spec) return spec.fixed;
  return fallback;
}

/** Contact normal runs along the member's length, so this face is an end. */
function meetsOnEnd(solid: SeatedMember, patch: SharedPatch): boolean {
  const axis = lengthAxis(solid);
  if (len(axis) < 1e-6) return false;
  return Math.abs(dot(normalize(axis), normalize(patchNormalFor(patch, solid.key)))) >= PARALLEL;
}

function patchesBetween(contacts: SceneContacts, a: string, b: string): SharedPatch[] {
  return contacts.patches.filter(
    (patch) =>
      (patch.a.instanceKey === a && patch.b.instanceKey === b) ||
      (patch.a.instanceKey === b && patch.b.instanceKey === a),
  );
}

function largestPatch(patches: SharedPatch[]): SharedPatch | undefined {
  return patches.reduce<SharedPatch | undefined>((best, patch) => {
    if (!best || patch.area > best.area) return patch;
    return best;
  }, undefined);
}

type Pair = { a: SeatedMember; b: SeatedMember; patch: SharedPatch };

function pairsOf(members: SeatedMember[], contacts: SceneContacts): Pair[] {
  const found: Pair[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const patch = largestPatch(patchesBetween(contacts, members[i].key, members[j].key));
      if (patch) found.push({ a: members[i], b: members[j], patch });
    }
  }
  found.sort((left, right) => right.patch.area - left.patch.area);
  return found;
}

export function membersTouch(members: SeatedMember[], contacts: SceneContacts): boolean {
  return pairsOf(members, contacts).length > 0;
}

type Run = { dir: Vec3; run: number };

/** Longest in-plane direction from `point` that stays inside the member. */
function bestInPlane(solid: SeatedMember, point: Vec3, up: Vec3): Run | undefined {
  const axes = [lengthAxis(solid), widthAxis(solid), thicknessAxis(solid)];
  let best: Run | undefined;
  for (const axis of axes) {
    if (len(axis) < 1e-6) continue;
    const unit = normalize(axis);
    if (Math.abs(dot(unit, up)) > 0.5) continue;
    for (const sign of [1, -1]) {
      const dir = scale(unit, sign);
      const run = runInto(solid, point, dir);
      if (!best || run > best.run) best = { dir, run };
    }
  }
  return best && best.run > 0.2 ? best : undefined;
}

function liftToSide(solid: SeatedMember, point: Vec3, dir: Vec3): Vec3 {
  const n = normalize(dir);
  if (len(n) < 1e-8) return point;
  let best = -Infinity;
  for (const face of worldOf(solid)) {
    for (const vertex of face) best = Math.max(best, dot(vertex, n));
  }
  if (!Number.isFinite(best)) return point;
  return add(point, scale(n, best - dot(point, n)));
}

function perpendicular(a: Vec3, b: Vec3): boolean {
  return Math.abs(dot(normalize(a), normalize(b))) <= PERP;
}

type EdgeChoice = {
  mid: Vec3;
  outward: Vec3;
  fold: Vec3;
  edgeLength: number;
  margin: number;
  face: SeatedMember;
  other: SeatedMember;
  intoOther: Vec3;
  otherRun: number;
};

/** Longest direction from `point` that is perpendicular to `fold` and stays in the member. */
function bestPerp(solid: SeatedMember, point: Vec3, fold: Vec3): Run | undefined {
  const axes = [lengthAxis(solid), widthAxis(solid), thicknessAxis(solid)];
  let best: Run | undefined;
  for (const axis of axes) {
    if (len(axis) < 1e-6) continue;
    const unit = normalize(axis);
    if (Math.abs(dot(unit, fold)) > 0.5) continue;
    for (const sign of [1, -1]) {
      const dir = scale(unit, sign);
      const run = runInto(solid, point, dir);
      if (!best || run > best.run) best = { dir, run };
    }
  }
  return best && best.run > 0.2 ? best : undefined;
}

function bracketEdge(pair: Pair, minLeg: number): EdgeChoice | undefined {
  const { a, b, patch } = pair;
  if (!perpendicular(lengthAxis(a), lengthAxis(b))) return undefined;
  const polygon = patch.polygon;
  if (polygon.length < 2) return undefined;
  let best: EdgeChoice | undefined;

  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const edge = sub(end, start);
    const edgeLength = len(edge);
    if (edgeLength < 0.75) continue;
    const mid = scale(add(start, end), 0.5);
    const fold = normalize(edge);
    const intoA = bestPerp(a, mid, fold);
    const intoB = bestPerp(b, mid, fold);
    if (!intoA || !intoB) continue;
    if (!perpendicular(intoA.dir, intoB.dir)) continue;
    if (intoA.run + 1e-3 < minLeg || intoB.run + 1e-3 < minLeg) continue;
    const candidate: EdgeChoice = {
      mid,
      outward: intoA.dir,
      fold,
      edgeLength,
      margin: Math.min(intoA.run, intoB.run),
      face: a,
      other: b,
      intoOther: intoB.dir,
      otherRun: intoB.run,
    };
    const lower = mid[1] < (best?.mid[1] ?? Infinity) - 0.5;
    if (!best || candidate.margin > best.margin + 1 || lower) best = candidate;
  }
  return best;
}

/** A fold may overhang a slightly shorter corner by up to half an inch. */
const FOLD_OVERHANG = 0.5;

function seatBracket(pair: Pair, part: CatalogPart): SeatedHardware | undefined {
  const legSpec = axisRange(part, "L");
  const foldSpec = axisRange(part, "W");
  const edge = bracketEdge(pair, legSpec.min);
  if (!edge) return undefined;
  const room = Math.min(edge.margin, edge.otherRun);
  const leg = legSpec.fixed ? part.size[0] : Math.min(room, Math.max(legSpec.min, defaultLeg(part)));
  if (leg > room + 0.08) return undefined;
  const fold = foldSpec.fixed ? part.size[1] : Math.min(Math.max(edge.edgeLength, foldSpec.min), foldSpec.max);
  if (fold > edge.edgeLength + FOLD_OVERHANG + 1e-3) return undefined;
  const gauge = part.size[2];
  return {
    origin: edge.mid,
    across: edge.outward,
    direction: normalize(edge.intoOther),
    size: [leg, fold, gauge],
    anchor: [0, 0, fold / 2],
    members: [edge.face.key, edge.other.key],
  };
}

function seatFlat(pair: Pair, part: CatalogPart): SeatedHardware | undefined {
  const { a, b, patch } = pair;
  const upA = thicknessAxis(a);
  const upB = thicknessAxis(b);
  if (len(upA) < 1e-6 || len(upB) < 1e-6) return undefined;
  const up = normalize(upA);
  if (dot(up, normalize(upB)) < PARALLEL) return undefined;
  const contact = normalize(patch.normal);
  if (Math.abs(dot(up, contact)) > PERP) return undefined;

  const leg = part.size[0];
  const arm = part.size[1];
  let best: { point: Vec3; dirA: Vec3; dirB: Vec3; run: number } | undefined;
  for (const point of patch.polygon) {
    const intoA = bestInPlane(a, point, up);
    const intoB = bestInPlane(b, point, up);
    if (!intoA || !intoB) continue;
    if (!perpendicular(intoA.dir, intoB.dir)) continue;
    const run = Math.min(intoA.run, intoB.run);
    if (run + 0.08 < leg) continue;
    if (!best || run > best.run) best = { point, dirA: intoA.dir, dirB: intoB.dir, run };
  }
  if (!best) return undefined;
  const faceWidth = Math.min(extentOf(a, best.dirB), extentOf(b, best.dirA));
  if (arm > faceWidth + 0.15) return undefined;
  // The second leg is local +Z = cross(+X, +Y). Sit on the other face when that
  // cross would point away from the second board.
  const plateUp = dot(cross(best.dirA, up), best.dirB) >= 0 ? up : scale(up, -1);
  return {
    origin: liftToSide(a, best.point, plateUp),
    across: best.dirA,
    direction: plateUp,
    size: [leg, arm, part.size[2]],
    anchor: [0, 0, 0],
    members: [a.key, b.key],
  };
}

function extentOf(solid: SeatedMember, axis: Vec3): number {
  const dir = normalize(axis);
  if (len(dir) < 1e-8) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const face of worldOf(solid)) {
    for (const point of face) {
      const t = dot(point, dir);
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
  }
  return Number.isFinite(min) ? max - min : 0;
}

function patchExtent(polygon: Face, axis: Vec3): number {
  const dir = normalize(axis);
  let min = Infinity;
  let max = -Infinity;
  for (const point of polygon) {
    const t = dot(point, dir);
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  return Number.isFinite(min) ? max - min : 0;
}

function seatSaddle(pair: Pair, part: CatalogPart): SeatedHardware | undefined {
  const { a, b, patch } = pair;
  const endA = meetsOnEnd(a, patch);
  const endB = meetsOnEnd(b, patch);
  if (endA === endB) return undefined;
  const support = endA ? a : b;
  const carried = endA ? b : a;
  const intoCarried = normalize(patchNormalFor(patch, support.key));
  if (Math.abs(dot(intoCarried, UP)) < PARALLEL) return undefined;
  const along = lengthAxis(carried);
  if (len(along) < 1e-6 || !perpendicular(along, intoCarried)) return undefined;
  const acrossBeam = normalize(along);
  const opening = extentOf(carried, normalize(cross(acrossBeam, intoCarried)));
  const bearing = patchExtent(patch.polygon, acrossBeam);
  const width = axisRange(part, "W");
  const length = axisRange(part, "L");
  if (opening < width.min - 1e-3 || opening > width.max + 1e-3) return undefined;
  if (bearing < length.min - 1e-3) return undefined;
  const seatLength = Math.min(bearing, length.max);
  const gauge = part.size[2];
  const center = centroid3(patch.polygon);
  const carriedCenter = boundsCenter(carried);
  const ontoPlane = dot(sub(center, carriedCenter), intoCarried);
  const origin = add(carriedCenter, scale(intoCarried, ontoPlane));
  return {
    origin,
    across: acrossBeam,
    direction: intoCarried,
    size: [seatLength, opening, gauge],
    anchor: [seatLength / 2, gauge, gauge + opening / 2],
    riser: featureOf(part, "flange", 2),
    members: [support.key, carried.key],
  };
}

function boundsCenter(solid: SeatedMember): Vec3 {
  const box = boundingBox(worldOf(solid));
  return scale(add(box.min, box.max), 0.5);
}

function seatHanger(pair: Pair, contacts: SceneContacts, part: CatalogPart): SeatedHardware | undefined {
  const { a, b, patch } = pair;
  const endA = meetsOnEnd(a, patch);
  const endB = meetsOnEnd(b, patch);
  if (endA === endB) return undefined;
  const joist = endA ? a : b;
  const header = endA ? b : a;
  const outOfJoist = normalize(patchNormalFor(patch, joist.key));
  if (Math.abs(dot(outOfJoist, UP)) > PERP) return undefined;
  const wDir = widthAxis(joist);
  const tDir = thicknessAxis(joist);
  if (len(wDir) < 1e-6 || len(tDir) < 1e-6) return undefined;
  const wVert = Math.abs(dot(normalize(wDir), UP));
  const tVert = Math.abs(dot(normalize(tDir), UP));
  if (Math.max(wVert, tVert) < PARALLEL) return undefined;
  const widthIsTall = wVert >= tVert;
  const tallSize = widthIsTall ? joist.stockSize[1] : joist.stockSize[2];
  const shortSize = widthIsTall ? joist.stockSize[2] : joist.stockSize[1];
  const opening = part.size[1];
  if (Math.abs(tallSize - 3.5) > 0.25 || Math.abs(shortSize - opening) > 0.25) return undefined;
  const tallDir = widthIsTall ? wDir : tDir;
  const up = dot(tallDir, UP) >= 0 ? normalize(tallDir) : scale(normalize(tallDir), -1);
  const intoJoist = scale(outOfJoist, -1);
  const gauge = part.size[2];
  const face = featureOf(part, "face", 1.5);
  const headerFace = hostForPatch(contacts, patch, header.key);
  const acrossJoist = normalize(cross(intoJoist, up));
  const headerSpan = headerFace
    ? patchExtent(headerFace.polygon, acrossJoist)
    : extentOf(header, acrossJoist);
  if (headerSpan + 0.1 < opening + 2 * face) return undefined;
  return {
    origin: centroid3(patch.polygon),
    across: intoJoist,
    direction: up,
    size: [part.size[0], opening, gauge],
    anchor: [gauge, gauge + tallSize / 2, face + gauge + opening / 2],
    riser: featureOf(part, "height", 3.125),
    face,
    members: [joist.key, header.key],
  };
}

function seatPair(kind: HardwareKind, pair: Pair, contacts: SceneContacts, part: CatalogPart): SeatedHardware | undefined {
  if (kind === "bracket") return seatBracket(pair, part);
  if (kind === "flat-bracket") return seatFlat(pair, part);
  if (kind === "saddle") return seatSaddle(pair, part);
  return seatHanger(pair, contacts, part);
}

export function seatHardware(
  kind: HardwareKind,
  part: CatalogPart,
  members: SeatedMember[],
  contacts: SceneContacts,
): SeatedHardware | undefined {
  if (stockGeometry(part) !== KIND_GEOMETRY[kind]) return undefined;
  for (const pair of pairsOf(members, contacts)) {
    const seated = seatPair(kind, pair, contacts, part);
    if (seated) return seated;
  }
  return undefined;
}

const EMPTY_STOCKS: Record<HardwareKind, string[]> = {
  bracket: [],
  "flat-bracket": [],
  saddle: [],
  hanger: [],
};

/** Catalog ids of each hardware kind that can seat on this joint. */
export function fittingHardware(
  members: SeatedMember[],
  contacts: SceneContacts,
): Record<HardwareKind, string[]> {
  const stocks: Record<HardwareKind, string[]> = {
    bracket: [],
    "flat-bracket": [],
    saddle: [],
    hanger: [],
  };
  if (members.length < 2) return stocks;
  const parts = listCatalog("hardware").filter((part) => part.renderable);
  for (const kind of Object.keys(KIND_GEOMETRY) as HardwareKind[]) {
    const matches = parts.filter((part) => stockGeometry(part) === KIND_GEOMETRY[kind]);
    stocks[kind] = matches
      .filter((part) => seatHardware(kind, part, members, contacts))
      .sort((a, b) => rank(b) - rank(a))
      .map((part) => part.id);
  }
  return stocks;
}

function rank(part: CatalogPart): number {
  const parametric = part.axes && !isFixedAxis(part.axes.L) ? 100 : 0;
  return parametric + part.size[0];
}

export function hardwareMiss(
  kind: HardwareKind,
  stockId: string,
  members: SeatedMember[],
  contacts: SceneContacts,
  path: Array<string | number>,
): FastenerIssue | undefined {
  const part = getCatalogPart(stockId);
  if (!part || seatHardware(kind, part, members, contacts)) return undefined;
  if (!membersTouch(members, contacts)) return undefined;
  return {
    message: `${KIND_LABEL[kind]} does not fit this joint`,
    path,
    severity: "warning",
  };
}

export function emptyHardwareStocks(): Record<HardwareKind, string[]> {
  return { ...EMPTY_STOCKS };
}
