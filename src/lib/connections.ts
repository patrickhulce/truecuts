import { getCatalogPart, type CatalogPart } from "./catalog";
import { parseInstanceKey, type FastenerIssue, type SceneFastener } from "./fasteners";
import {
  add,
  centroid3,
  dot,
  FACE_IDS,
  faceFrame,
  fromPlane2D,
  insetConvex,
  inverseRotateEulerXYZ,
  layoutClosed,
  layoutOpen,
  len,
  normalize,
  planeBasis,
  scale,
  sub,
  toPlane2D,
  unapplyPose,
  worldPolyhedron,
  type Face,
  type FaceId,
  type PlacedBore,
  type Polyhedron,
  type SceneContacts,
  type SharedPatch,
  type Vec2,
  type Vec3,
} from "./geometry";
import { axisCoord } from "./geometry/types";
import { faceNormal } from "./geometry/solids";
import type {
  ResolvedConnection,
  ResolvedConnectionFastener,
  ResolvedConnectionMember,
  ResolvedDocument,
  ResolvedGlueVariant,
  ResolvedScrewVariant,
} from "./schema";

export const SCREW_PILOT_RATIO = 0.7;
const HIT_EPS = 1e-4;
const THROUGH_SLACK = 0.05;
/**
 * A plate's gauge-thick edge can kiss the same member as its bearing face
 * (catalog gauges are 1/8″ and 1/4″). Patches thinner than this are that edge,
 * not a second flange.
 */
const BEARING_SPAN = 0.4;

export type ConnectionSolid = {
  key: string;
  memberId: string;
  faces: Polyhedron;
  position: Vec3;
  rotation: Vec3;
  componentId: string;
  componentPosition: Vec3;
  componentRotation: Vec3;
  stockSize: Vec3;
};

export type DerivedBore = {
  instanceKey: string;
  role: "pilot" | "clearance";
  bore: PlacedBore;
};

export type SceneConnection = {
  key: string;
  componentId: string | null;
  index: number;
  memberKeys: string[];
  fasteners: ResolvedConnectionFastener[];
  bores: DerivedBore[];
};

export function connectionKey(componentId: string | null, index: number): string {
  return componentId ? `${componentId}/connection#${index}` : `connection#${index}`;
}

/**
 * Other instances that belong in the detail pane's Attached list.
 * Connections count even when every recipe is `none` (no expanded fastener).
 */
export function attachmentNeighborKeys(
  selectedKey: string,
  connections: Array<Pick<SceneConnection, "memberKeys">>,
  fasteners: Array<{ members: Array<{ instanceKey: string }> }>,
): string[] {
  const keys = new Set<string>();
  for (const connection of connections) {
    if (!connection.memberKeys.includes(selectedKey)) continue;
    for (const key of connection.memberKeys) {
      if (key !== selectedKey) keys.add(key);
    }
  }
  for (const fastener of fasteners) {
    if (!fastener.members.some((member) => member.instanceKey === selectedKey)) continue;
    for (const member of fastener.members) {
      if (member.instanceKey !== selectedKey) keys.add(member.instanceKey);
    }
  }
  return [...keys];
}

/** Instance pairs whose shared contact the connection layout edits. */
export function connectionContactPairs(connection: SceneConnection): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  const add = (a: string, b: string) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([a, b]);
  };
  let bracketed = false;
  for (const fastener of connection.fasteners) {
    const variant = fastener.kind === "screw" || fastener.kind === "bolt" ? fastener.variant : null;
    if (!variant || variant.kind !== "angle-bracket") continue;
    const bracketKey = connection.memberKeys.find(
      (key) => parseInstanceKey(key).memberId === variant.bracket,
    );
    if (!bracketKey) continue;
    bracketed = true;
    for (const key of connection.memberKeys) {
      if (key !== bracketKey) add(bracketKey, key);
    }
  }
  if (!bracketed) {
    const head = connection.memberKeys[0];
    if (head) {
      for (const key of connection.memberKeys.slice(1)) add(head, key);
    }
  }
  return pairs;
}

export function parseConnectionKey(key: string): { componentId: string | null; index: number } {
  const marker = "/connection#";
  const split = key.lastIndexOf(marker);
  if (split >= 0) {
    return { componentId: key.slice(0, split), index: Number(key.slice(split + marker.length)) };
  }
  if (key.startsWith("connection#")) {
    return { componentId: null, index: Number(key.slice("connection#".length)) };
  }
  throw new Error(`Invalid connection key "${key}"`);
}

function patchesBetween(contacts: SceneContacts, a: string, b: string): SharedPatch[] {
  return contacts.patches.filter(
    (patch) =>
      (patch.a.instanceKey === a && patch.b.instanceKey === b) ||
      (patch.a.instanceKey === b && patch.b.instanceKey === a),
  );
}

/** Smaller in-plane span of a contact polygon. Axis-aligned faces have one near-zero AABB axis. */
function patchMinorSpan(polygon: Face): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of polygon) {
    min[0] = Math.min(min[0], point[0]);
    min[1] = Math.min(min[1], point[1]);
    min[2] = Math.min(min[2], point[2]);
    max[0] = Math.max(max[0], point[0]);
    max[1] = Math.max(max[1], point[1]);
    max[2] = Math.max(max[2], point[2]);
  }
  const spans = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].filter((span) => span > 1e-3);
  if (spans.length === 0) return 0;
  return Math.min(...spans);
}

function largestPatch(patches: SharedPatch[]): SharedPatch | undefined {
  return patches.reduce<SharedPatch | undefined>((best, patch) => {
    if (!best || patch.area > best.area) return patch;
    return best;
  }, undefined);
}

function pointInConvexFace(point: Vec3, face: Face, normal: Vec3): boolean {
  const n = normalize(normal);
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const inward = crossSafe(n, sub(b, a));
    if (dot(inward, sub(point, a)) < -1e-4) return false;
  }
  return true;
}

function crossSafe(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Distance from `origin` along `dir` to the next face of a (possibly non-convex) solid. */
export function rayFaceDistance(faces: Polyhedron, origin: Vec3, dir: Vec3): number {
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

function polygonLength(poly: Face): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    total += len(sub(poly[(i + 1) % poly.length], poly[i]));
  }
  return total;
}

function pointAlong(poly: Face, distance: number): Vec3 {
  if (poly.length === 0) return [0, 0, 0];
  let remaining = distance;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const edgeLen = len(sub(b, a));
    if (edgeLen < 1e-8) continue;
    if (remaining <= edgeLen + 1e-8) return add(a, scale(normalize(sub(b, a)), Math.max(remaining, 0)));
    remaining -= edgeLen;
  }
  return poly[0];
}

function centerline(poly: Face, normal: Vec3): { start: Vec3; end: Vec3 } | null {
  if (poly.length < 2) return null;
  const origin = centroid3(poly);
  let best = 0;
  let axis = planeBasis(normal).u;
  for (let i = 0; i < poly.length; i++) {
    const delta = sub(poly[(i + 1) % poly.length], poly[i]);
    const distance = len(delta);
    if (distance > best) {
      best = distance;
      axis = normalize(delta);
    }
  }
  const { u, v } = planeBasis(normal);
  const axis2: Vec2 = [dot(axis, u), dot(axis, v)];
  const points = poly.map((point) => toPlane2D(point, origin, u, v));
  const ts: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const det = axis2[0] * -ab[1] + ab[0] * axis2[1];
    if (Math.abs(det) < 1e-9) continue;
    const t = (a[0] * -ab[1] + ab[0] * a[1]) / det;
    const s = (axis2[0] * a[1] - a[0] * axis2[1]) / det;
    if (s >= -1e-6 && s <= 1 + 1e-6) ts.push(t);
  }
  if (ts.length < 2) return { start: origin, end: origin };
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  return {
    start: fromPlane2D([axis2[0] * tMin, axis2[1] * tMin], origin, u, v),
    end: fromPlane2D([axis2[0] * tMax, axis2[1] * tMax], origin, u, v),
  };
}

export function layoutScrewPoints(variant: ResolvedScrewVariant, polygon: Face, normal: Vec3): Vec3[] {
  if (polygon.length < 3) return [];
  if (variant.kind === "four-corners") {
    return insetConvex(polygon, normal, variant.edge) ?? polygon;
  }
  if (variant.kind === "angle-bracket") {
    const inset = insetConvex(polygon, normal, variant.edge);
    return [centroid3(inset ?? polygon)];
  }
  if (variant.kind === "perimeter") {
    const inset = insetConvex(polygon, normal, variant.edge) ?? polygon;
    const length = polygonLength(inset);
    return layoutClosed(length, variant.separation, variant.justify).map((distance) => pointAlong(inset, distance));
  }
  const segment = centerline(polygon, normal);
  if (!segment) return [centroid3(polygon)];
  const span = sub(segment.end, segment.start);
  const length = len(span);
  if (length < 1e-6) return [segment.start];
  const dir = normalize(span);
  return layoutOpen(length, variant.separation, variant.justify).map((distance) => add(segment.start, scale(dir, distance)));
}

function gluePoint(polygon: Face, normal: Vec3, variant: ResolvedGlueVariant): Vec3 {
  if (variant.kind === "patch" || polygon.length < 2) return centroid3(polygon);
  const center = centroid3(polygon);
  let best = -1;
  let mid = center;
  let inward: Vec3 = [0, 0, 0];
  const n = normalize(normal);
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const edge = sub(b, a);
    const edgeLen = len(edge);
    if (edgeLen <= best) continue;
    best = edgeLen;
    mid = add(a, scale(edge, 0.5));
    inward = normalize(crossSafe(n, normalize(edge)));
  }
  if (dot(inward, sub(center, mid)) < 0) inward = scale(inward, -1);
  return add(mid, scale(inward, variant.edge));
}

function worldOf(solid: ConnectionSolid): Polyhedron {
  return worldPolyhedron(
    solid.faces,
    solid.position,
    solid.rotation,
    solid.componentPosition,
    solid.componentRotation,
  );
}

function toLocal(solid: ConnectionSolid, world: Vec3): Vec3 {
  return unapplyPose(
    unapplyPose(world, solid.componentPosition, solid.componentRotation),
    solid.position,
    solid.rotation,
  );
}

function dirToLocal(solid: ConnectionSolid, dir: Vec3): Vec3 {
  return inverseRotateEulerXYZ(inverseRotateEulerXYZ(dir, solid.componentRotation), solid.rotation);
}

function makeBore(localCenter: Vec3, outward: Vec3, diameter: number, depth: number, size: Vec3): PlacedBore {
  let face: FaceId = FACE_IDS[0];
  let best = -Infinity;
  const normal = normalize(outward);
  for (const id of FACE_IDS) {
    const score = dot(faceFrame(id, size).normal, normal);
    if (score > best) {
      best = score;
      face = id;
    }
  }
  const frame = faceFrame(face, size);
  const stockDepth = size[frame.normalAxis];
  return {
    face,
    at: [localCenter[axisCoord(frame.axes[0])], localCenter[axisCoord(frame.axes[1])]],
    diameter,
    depth,
    through: depth >= stockDepth - 1e-3,
    center: localCenter,
    normal: len(normal) > 1e-8 ? normal : frame.normal,
  };
}

function catalogOf(stockId: string, path: Array<string | number>, issues: FastenerIssue[]): CatalogPart | undefined {
  const catalog = getCatalogPart(stockId);
  if (!catalog) {
    issues.push({ message: `Unknown fastener stock "${stockId}"`, path, severity: "error" });
    return undefined;
  }
  return catalog;
}

function placeMechanical(
  kind: "screw" | "bolt",
  point: Vec3,
  head: ConnectionSolid,
  tip: ConnectionSolid,
  direction: Vec3,
  catalog: CatalogPart,
  key: string,
  connectionKey: string,
): { fastener: SceneFastener; bores: DerivedBore[] } {
  const intoTip = normalize(direction);
  const headFaces = worldOf(head);
  const tipFaces = worldOf(tip);
  const back = rayFaceDistance(headFaces, point, scale(intoTip, -1));
  const forward = rayFaceDistance(tipFaces, point, intoTip);
  const length = catalog.size[0];
  const diameter = catalog.size[1];
  const spansHead = kind === "bolt" || (length > back + THROUGH_SLACK && back > 1e-3);
  const origin = spansHead ? add(point, scale(intoTip, -back)) : point;
  const bores: DerivedBore[] = [];

  if (spansHead && back > 1e-3) {
    bores.push({
      instanceKey: head.key,
      role: "clearance",
      bore: makeBore(toLocal(head, origin), dirToLocal(head, scale(intoTip, -1)), diameter, back, head.stockSize),
    });
  }

  const pilotDepth = spansHead ? Math.min(Math.max(length - back, 0), forward) : Math.min(length, forward);
  const pilotDiameter = kind === "screw" ? diameter * SCREW_PILOT_RATIO : diameter;
  if (kind === "bolt" && forward > 1e-3) {
    bores.push({
      instanceKey: tip.key,
      role: "clearance",
      bore: makeBore(toLocal(tip, point), dirToLocal(tip, scale(intoTip, -1)), diameter, forward, tip.stockSize),
    });
  } else if (pilotDepth > 1e-3) {
    bores.push({
      instanceKey: tip.key,
      role: "pilot",
      bore: makeBore(toLocal(tip, point), dirToLocal(tip, scale(intoTip, -1)), pilotDiameter, pilotDepth, tip.stockSize),
    });
  }

  const grip = back + forward;
  return {
    fastener: {
      key,
      connectionKey,
      stockId: catalog.id,
      stockLabel: catalog.label,
      subtype: kind,
      color: catalog.color,
      origin,
      direction: intoTip,
      length,
      diameter,
      size: catalog.size,
      ...(kind === "bolt" ? { grip } : {}),
      members: [
        { instanceKey: head.key, point, direction: normalize(dirToLocal(head, intoTip)) },
        { instanceKey: tip.key, point, direction: normalize(dirToLocal(tip, intoTip)) },
      ],
    },
    bores,
  };
}

function noteBoltSpan(
  fastener: SceneFastener,
  catalog: CatalogPart,
  path: Array<string | number>,
  issues: FastenerIssue[],
): void {
  if (fastener.grip === undefined) return;
  if (catalog.size[0] + THROUGH_SLACK < fastener.grip) {
    issues.push({
      message: `Bolt "${catalog.label}" (${catalog.size[0]}″) does not span the joint (${fastener.grip.toFixed(2)}″)`,
      path,
      severity: "warning",
    });
  }
}

function headDirection(patch: SharedPatch, headKey: string): Vec3 {
  if (patch.a.instanceKey === headKey) return patch.normal;
  return scale(patch.normal, -1);
}

type Expansion = {
  fasteners: SceneFastener[];
  edges: Array<[string, string]>;
  bores: DerivedBore[];
  touched: Set<string>;
};

function expandFastener(
  recipe: ResolvedConnectionFastener,
  recipeIndex: number,
  members: ConnectionSolid[],
  contacts: SceneContacts,
  keyPrefix: string,
  path: Array<string | number>,
  issues: FastenerIssue[],
): Expansion {
  const fasteners: SceneFastener[] = [];
  const edges: Array<[string, string]> = [];
  const bores: DerivedBore[] = [];
  const touched = new Set<string>();
  if (recipe.kind === "none") return { fasteners, edges, bores, touched };
  const catalog = catalogOf(recipe.stock, [...path, "fasteners", recipeIndex, "stock"], issues);
  if (!catalog || members.length < 2) return { fasteners, edges, bores, touched };

  const link = (a: string, b: string) => {
    edges.push([a, b]);
    touched.add(a);
    touched.add(b);
  };

  if (recipe.kind === "glue") {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const patch = largestPatch(patchesBetween(contacts, members[i].key, members[j].key));
        if (!patch) continue;
        const point = gluePoint(patch.polygon, patch.normal, recipe.variant);
        const key = `${keyPrefix}/fastener#${recipeIndex}/glue#${fasteners.length}`;
        fasteners.push({
          key,
          connectionKey: keyPrefix,
          stockId: catalog.id,
          stockLabel: catalog.label,
          subtype: "glue",
          color: catalog.color,
          origin: point,
          direction: patch.normal,
          length: catalog.size[0],
          diameter: catalog.size[1],
          size: catalog.size,
          members: [members[i], members[j]].map((solid) => ({
            instanceKey: solid.key,
            point,
            direction: normalize(dirToLocal(solid, patch.normal)),
          })),
        });
        link(members[i].key, members[j].key);
      }
    }
    return { fasteners, edges, bores, touched };
  }

  if ((recipe.kind === "screw" || recipe.kind === "bolt") && recipe.variant.kind === "angle-bracket") {
    const bracketId = recipe.variant.bracket;
    const edge = recipe.variant.edge;
    const kind = recipe.kind;
    const bracketSolid = members.find((solid) => solid.memberId === bracketId);
    if (!bracketSolid) {
      issues.push({
        message: `angle-bracket "${bracketId}" is not placed in this connection`,
        path: [...path, "fasteners", recipeIndex, "variant", "bracket"],
        severity: "error",
      });
      return { fasteners, edges, bores, touched };
    }
    const layout = { kind: "angle-bracket" as const, bracket: bracketId, edge };
    for (const target of members) {
      if (target.key === bracketSolid.key) continue;
      const patches = patchesBetween(contacts, bracketSolid.key, target.key).filter(
        (patch) => patchMinorSpan(patch.polygon) >= BEARING_SPAN,
      );
      for (const patch of patches) {
        const points = layoutScrewPoints(layout, patch.polygon, patch.normal);
        const direction = headDirection(patch, bracketSolid.key);
        for (const point of points) {
          const placed = placeMechanical(
            kind,
            point,
            bracketSolid,
            target,
            direction,
            catalog,
            `${keyPrefix}/fastener#${recipeIndex}/${kind}#${fasteners.length}`,
            keyPrefix,
          );
          if (kind === "bolt") noteBoltSpan(placed.fastener, catalog, [...path, "fasteners", recipeIndex], issues);
          fasteners.push(placed.fastener);
          bores.push(...placed.bores);
          link(bracketSolid.key, target.key);
        }
      }
    }
    return { fasteners, edges, bores, touched };
  }

  const head = members[0];
  for (const tip of members.slice(1)) {
    const patch = largestPatch(patchesBetween(contacts, head.key, tip.key));
    if (!patch) continue;
    if (recipe.kind === "bolt") {
      const point = centroid3(patch.polygon);
      const placed = placeMechanical(
        "bolt",
        point,
        head,
        tip,
        headDirection(patch, head.key),
        catalog,
        `${keyPrefix}/fastener#${recipeIndex}/bolt#${fasteners.length}`,
        keyPrefix,
      );
      if (recipe.kind === "bolt") noteBoltSpan(placed.fastener, catalog, [...path, "fasteners", recipeIndex], issues);
      fasteners.push(placed.fastener);
      bores.push(...placed.bores);
      link(head.key, tip.key);
      continue;
    }
    const points = layoutScrewPoints(recipe.variant, patch.polygon, patch.normal);
    const direction = headDirection(patch, head.key);
    for (const point of points) {
      const placed = placeMechanical(
        "screw",
        point,
        head,
        tip,
        direction,
        catalog,
        `${keyPrefix}/fastener#${recipeIndex}/screw#${fasteners.length}`,
        keyPrefix,
      );
      fasteners.push(placed.fastener);
      bores.push(...placed.bores);
      link(head.key, tip.key);
    }
  }
  return { fasteners, edges, bores, touched };
}

function expandOne(
  connection: ResolvedConnection,
  index: number,
  componentId: string | null,
  solids: ConnectionSolid[],
  contacts: SceneContacts,
  path: Array<string | number>,
  issues: FastenerIssue[],
): { fasteners: SceneFastener[]; edges: Array<[string, string]>; bores: DerivedBore[]; scene: SceneConnection } | undefined {
  const members: ConnectionSolid[] = [];
  for (const [mIndex, member] of connection.members.entries()) {
    const solid = findSolid(solids, member);
    if (!solid) {
      issues.push({
        message: `Member "${member.id}" is not placed in component "${member.component}"`,
        path: [...path, "members", mIndex, "id"],
        severity: "error",
      });
      continue;
    }
    members.push(solid);
  }
  if (members.length !== connection.members.length) return undefined;

  const key = connectionKey(componentId, index);
  const fasteners: SceneFastener[] = [];
  const edges: Array<[string, string]> = [];
  const bores: DerivedBore[] = [];
  const touched = new Set<string>();
  for (const [recipeIndex, recipe] of connection.fasteners.entries()) {
    const expanded = expandFastener(recipe, recipeIndex, members, contacts, key, path, issues);
    fasteners.push(...expanded.fasteners);
    edges.push(...expanded.edges);
    bores.push(...expanded.bores);
    for (const id of expanded.touched) touched.add(id);
  }

  const onlyNone = connection.fasteners.every((recipe) => recipe.kind === "none");
  if (!onlyNone) {
    for (const solid of members) {
      if (touched.has(solid.key)) continue;
      issues.push({
        message: `Connection has no contact between "${solid.memberId}" and the other members`,
        path,
        severity: "warning",
      });
    }
  }

  return {
    fasteners,
    edges,
    bores,
    scene: {
      key,
      componentId,
      index,
      memberKeys: members.map((solid) => solid.key),
      fasteners: connection.fasteners,
      bores,
    },
  };
}

function findSolid(solids: ConnectionSolid[], member: ResolvedConnectionMember): ConnectionSolid | undefined {
  let seen = 0;
  for (const solid of solids) {
    if (solid.componentId !== member.component || solid.memberId !== member.id) continue;
    if (seen === member.index) return solid;
    seen += 1;
  }
  return undefined;
}

export function expandConnections(
  document: ResolvedDocument,
  solids: ConnectionSolid[],
  contacts: SceneContacts,
): {
  fasteners: SceneFastener[];
  edges: Array<[string, string]>;
  bores: DerivedBore[];
  connections: SceneConnection[];
  issues: FastenerIssue[];
} {
  const issues: FastenerIssue[] = [];
  const fasteners: SceneFastener[] = [];
  const edges: Array<[string, string]> = [];
  const bores: DerivedBore[] = [];
  const connections: SceneConnection[] = [];

  for (const [cIndex, component] of document.components.entries()) {
    for (const [index, connection] of component.connections.entries()) {
      const expanded = expandOne(
        connection,
        index,
        component.id,
        solids,
        contacts,
        ["components", cIndex, "connections", index],
        issues,
      );
      if (!expanded) continue;
      fasteners.push(...expanded.fasteners);
      edges.push(...expanded.edges);
      bores.push(...expanded.bores);
      connections.push(expanded.scene);
    }
  }

  for (const [index, connection] of document.connections.entries()) {
    const expanded = expandOne(connection, index, null, solids, contacts, ["connections", index], issues);
    if (!expanded) continue;
    fasteners.push(...expanded.fasteners);
    edges.push(...expanded.edges);
    bores.push(...expanded.bores);
    connections.push(expanded.scene);
  }

  return { fasteners, edges, bores, connections, issues };
}
