import { getCatalogPart, stockGeometry, type CatalogPart, type StockGeometry } from "./catalog";
import { expandConnections, rayFaceDistance, type ConnectionSolid, type SceneConnection } from "./connections";
import {
  fastenedFromSeed,
  instanceKey,
  resolveFasteners,
  worldPoint,
  type SceneFastener,
} from "./fasteners";
import {
  applyCuts,
  boundingBox,
  clipPolyhedron,
  cutToPlane,
  findContacts,
  flatLBracketPolyhedron,
  lBracketPolyhedron,
  normalize,
  polyhedronVolume,
  rodPolyhedron,
  saddlePolyhedron,
  scale,
  tConnectorPolyhedron,
  worldPolyhedron,
  type Polyhedron,
  type SceneContacts,
  type Vec3,
} from "./geometry";
import type { ResolvedBore, ResolvedCut, ResolvedDocument, ResolvedMember } from "./schema";

export type SceneMemberInstance = {
  key: string;
  memberId: string;
  label: string;
  stockId: string;
  stockLabel: string;
  material: string;
  color: string;
  faces: Polyhedron;
  /** Bores written on the member. Connection pilots and clearance live in `derivedBores`. */
  bores: ResolvedBore[];
  derivedBores: ResolvedBore[];
  position: Vec3;
  rotation: Vec3;
  bounds: { min: Vec3; max: Vec3 };
  worldBounds: { min: Vec3; max: Vec3 };
  worldCenter: Vec3;
  finished: { length: number; width: number; thickness: number };
  fastened: boolean;
};

export type SceneComponent = {
  id: string;
  label: string;
  position: Vec3;
  rotation: Vec3;
  members: SceneMemberInstance[];
};

export type SceneModel = {
  name: string;
  center: Vec3;
  components: SceneComponent[];
  fasteners: SceneFastener[];
  contacts: SceneContacts;
  connections: SceneConnection[];
};

export type { SceneFastener, SceneFastenerMember } from "./fasteners";
export type { SceneConnection, DerivedBore } from "./connections";

export type SceneIssue = {
  message: string;
  path: Array<string | number>;
  severity?: "error" | "warning";
};

function finishedFromBounds(bounds: { min: Vec3; max: Vec3 }): {
  length: number;
  width: number;
  thickness: number;
} {
  return {
    length: bounds.max[0] - bounds.min[0],
    width: bounds.max[2] - bounds.min[2],
    thickness: bounds.max[1] - bounds.min[1],
  };
}

function assertCutInBounds(cut: ResolvedCut, size: Vec3, memberId: string): void {
  const dimName = (["L", "W", "T"] as const)[cut.axis];
  const limit = size[cut.axis];
  if (typeof cut.at === "number") {
    if (cut.at < -1e-6 || cut.at > limit + 1e-6) {
      throw new Error(
        `Cut on ${memberId} at ${cut.at} is outside stock axis ${cut.axis} (${dimName}, 0–${limit})`,
      );
    }
    return;
  }
  const [short, long] = cut.at;
  if (short < -1e-6 || long > limit + 1e-6) {
    throw new Error(
      `Cut on ${memberId} [${short}, ${long}] is outside stock axis ${cut.axis} (${dimName}, 0–${limit})`,
    );
  }
}

const HEAD_COVER_SLACK = 0.05;

/** Wood (or another joined member) lies on the driver side of a screw head. */
function screwHeadCovered(
  fastener: SceneFastener,
  byKey: Map<string, SceneMemberInstance>,
  componentOf: Map<string, SceneComponent>,
): boolean {
  if (fastener.subtype !== "screw" && fastener.subtype !== "nail") return false;
  const backward = scale(normalize(fastener.direction), -1);
  return fastener.members.some((member) => {
    const instance = byKey.get(member.instanceKey);
    const component = componentOf.get(member.instanceKey);
    if (!instance || !component) return false;
    const faces = worldPolyhedron(
      instance.faces,
      instance.position,
      instance.rotation,
      component.position,
      component.rotation,
    );
    return rayFaceDistance(faces, fastener.origin, backward) > HEAD_COVER_SLACK;
  });
}

function midpoint(min: Vec3, max: Vec3): Vec3 {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

function centerFromWorldCenters(centers: Vec3[]): Vec3 {
  if (centers.length === 0) return [0, 0, 0];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of centers) {
    min[0] = Math.min(min[0], point[0]);
    min[1] = Math.min(min[1], point[1]);
    min[2] = Math.min(min[2], point[2]);
    max[0] = Math.max(max[0], point[0]);
    max[1] = Math.max(max[1], point[1]);
    max[2] = Math.max(max[2], point[2]);
  }
  return midpoint(min, max);
}

const FLOOR_REST_SLACK = 1e-4;

/** Radiate members from the scene center. Downward motion stops at `floorY`. */
export function computeExplodeOffsets(scene: SceneModel, explode: number, floorY = 0): Map<string, Vec3> {
  const map = new Map<string, Vec3>();
  if (explode === 0) return map;
  for (const component of scene.components) {
    for (const part of component.members) {
      const dx = (part.worldCenter[0] - scene.center[0]) * explode;
      const dz = (part.worldCenter[2] - scene.center[2]) * explode;
      const desiredDy = (part.worldCenter[1] - scene.center[1]) * explode;
      const partMinY = part.worldBounds.min[1];
      let dy = desiredDy;
      if (desiredDy < 0) {
        dy = partMinY <= floorY + FLOOR_REST_SLACK ? 0 : Math.max(desiredDy, floorY - partMinY);
      }
      map.set(part.key, [dx, dy, dz]);
    }
  }
  return map;
}

const GEOMETRY_LABEL: Record<Exclude<StockGeometry, "box" | "rod">, string> = {
  "bracket-l": "L-bracket",
  "bracket-flat-l": "Flat L-bracket",
  "connector-t": "T-connector",
  saddle: "Saddle",
};

function featureHeight(member: ResolvedMember, name: string, label: string): number {
  const value = member.features[name];
  if (!(value > 0)) {
    throw new Error(`${label} ${member.id} is missing ${name}`);
  }
  return value;
}

function hardwarePolyhedron(member: ResolvedMember, geometry: Exclude<StockGeometry, "box" | "rod">): Polyhedron {
  const label = GEOMETRY_LABEL[geometry];
  if (member.cuts.length > 0) {
    throw new Error(`${label} ${member.id} cannot take planar cuts`);
  }
  switch (geometry) {
    case "bracket-l":
      return lBracketPolyhedron(member.size);
    case "bracket-flat-l":
      return flatLBracketPolyhedron(member.size);
    case "connector-t":
      return tConnectorPolyhedron(member.size, featureHeight(member, "riser", label));
    case "saddle":
      return saddlePolyhedron(member.size, featureHeight(member, "flange", label));
  }
}

function meshRod(member: ResolvedMember): Polyhedron {
  for (const cut of member.cuts) {
    assertCutInBounds(cut, member.size, member.id);
  }
  let poly = rodPolyhedron(member.size);
  for (const cut of member.cuts) {
    poly = clipPolyhedron(poly, cutToPlane(cut, member.size));
  }
  if (polyhedronVolume(poly) < 1e-6) {
    throw new Error(`Cuts on ${member.id} removed all material`);
  }
  return poly;
}

export function meshMember(member: ResolvedMember, stock: CatalogPart): Polyhedron {
  const geometry = stockGeometry(stock);
  if (geometry === "rod") return meshRod(member);
  if (geometry !== "box") {
    const poly = hardwarePolyhedron(member, geometry);
    if (polyhedronVolume(poly) < 1e-6) {
      throw new Error(`${GEOMETRY_LABEL[geometry]} ${member.id} has no volume`);
    }
    return poly;
  }
  for (const cut of member.cuts) {
    assertCutInBounds(cut, member.size, member.id);
  }
  const poly = applyCuts(member.size, member.cuts);
  if (polyhedronVolume(poly) < 1e-6) {
    throw new Error(`Cuts on ${member.id} removed all material`);
  }
  return poly;
}

export function buildScene(document: ResolvedDocument): {
  scene?: SceneModel;
  issues: SceneIssue[];
} {
  const issues: SceneIssue[] = [];
  const meshes = new Map<string, { member: ResolvedMember; stock: CatalogPart; faces: Polyhedron }>();

  for (const [index, member] of document.members.entries()) {
    const stock = getCatalogPart(member.stock);
    if (!stock) {
      issues.push({
        message: `Unknown stock "${member.stock}"`,
        path: ["members", index, "stock"],
      });
      continue;
    }
    if (!stock.renderable) {
      issues.push({
        message: `Stock "${member.stock}" is catalogued but not renderable as member stock`,
        path: ["members", index, "stock"],
      });
      continue;
    }
    try {
      meshes.set(member.id, { member, stock, faces: meshMember(member, stock) });
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: ["members", index, "cuts"],
      });
    }
  }

  if (issues.length > 0) {
    return { issues };
  }

  const components: SceneComponent[] = document.components.map((component) => ({
    id: component.id,
    label: component.label,
    position: component.position,
    rotation: component.rotation,
    members: component.members.flatMap((placement, index) => {
      const mesh = meshes.get(placement.id);
      if (!mesh) return [];
      const bounds = boundingBox(mesh.faces);
      const worldBounds = boundingBox(
        worldPolyhedron(
          mesh.faces,
          placement.position,
          placement.rotation,
          component.position,
          component.rotation,
        ),
      );
      return [
        {
          key: instanceKey(component.id, placement.id, index),
          memberId: mesh.member.id,
          label: mesh.member.label,
          stockId: mesh.stock.id,
          stockLabel: mesh.stock.label,
          material: mesh.stock.material,
          color: mesh.stock.color,
          faces: mesh.faces,
          bores: [...mesh.member.bores],
          derivedBores: [],
          position: placement.position,
          rotation: placement.rotation,
          bounds,
          worldBounds,
          worldCenter: worldPoint(midpoint(bounds.min, bounds.max), placement, component),
          finished: finishedFromBounds(bounds),
          fastened: false,
        },
      ];
    }),
  }));

  const resolved = resolveFasteners(document);
  issues.push(...resolved.issues);

  const explicitErrors = issues.filter((issue) => (issue.severity ?? "error") === "error");
  if (explicitErrors.length > 0) {
    return { issues };
  }

  const contacts = findContacts(
    components.flatMap((component) =>
      component.members.map((member) => ({
        key: member.key,
        faces: member.faces,
        position: member.position,
        rotation: member.rotation,
        componentPosition: component.position,
        componentRotation: component.rotation,
        bounds: member.bounds,
      })),
    ),
  );

  const solids: ConnectionSolid[] = components.flatMap((component) =>
    component.members.map((member) => ({
      key: member.key,
      memberId: member.memberId,
      faces: member.faces,
      position: member.position,
      rotation: member.rotation,
      componentId: component.id,
      componentPosition: component.position,
      componentRotation: component.rotation,
      stockSize: meshes.get(member.memberId)?.member.size ?? [0, 0, 0],
      stockId: meshes.get(member.memberId)?.stock.id ?? "",
    })),
  );
  const expanded = expandConnections(document, solids, contacts);
  issues.push(...expanded.issues);

  const errors = issues.filter((issue) => (issue.severity ?? "error") === "error");
  if (errors.length > 0) {
    return { issues };
  }

  const byKey = new Map(components.flatMap((component) => component.members.map((member) => [member.key, member])));
  for (const derived of expanded.bores) {
    byKey.get(derived.instanceKey)?.derivedBores.push(derived.bore);
  }

  const componentOf = new Map(
    components.flatMap((component) => component.members.map((member) => [member.key, component] as const)),
  );
  const fasteners = [...resolved.fasteners, ...expanded.fasteners].map((fastener) => ({
    ...fastener,
    ...(fastener.subtype === "screw" || fastener.subtype === "nail"
      ? { headCovered: screwHeadCovered(fastener, byKey, componentOf) }
      : {}),
  }));
  const edges = [...resolved.edges, ...expanded.edges];
  const nodes = components.flatMap((component) => component.members.map((member) => member.key));
  const seed = components[0]?.members[0]?.key;
  const fastened = fastenedFromSeed(nodes, edges, seed);

  for (const component of components) {
    for (const member of component.members) {
      member.fastened = fastened.has(member.key);
    }
  }

  const allMembers = components.flatMap((component) => component.members);
  return {
    scene: {
      name: document.name,
      center: centerFromWorldCenters(allMembers.map((member) => member.worldCenter)),
      components,
      fasteners,
      contacts,
      connections: expanded.connections,
    },
    issues,
  };
}
