import { getCatalogPart, isFlatLBracket, isLBracket, type CatalogPart } from "./catalog";
import { expandConnections, type ConnectionSolid, type SceneConnection } from "./connections";
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
  findContacts,
  flatLBracketPolyhedron,
  lBracketPolyhedron,
  polyhedronVolume,
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

export function meshMember(member: ResolvedMember, stock: CatalogPart): Polyhedron {
  if (isLBracket(stock) || isFlatLBracket(stock)) {
    if (member.cuts.length > 0) {
      throw new Error(`L-bracket ${member.id} cannot take planar cuts`);
    }
    const poly = isFlatLBracket(stock) ? flatLBracketPolyhedron(stock.size) : lBracketPolyhedron(stock.size);
    if (polyhedronVolume(poly) < 1e-6) {
      throw new Error(`L-bracket ${member.id} has no volume`);
    }
    return poly;
  }
  for (const cut of member.cuts) {
    assertCutInBounds(cut, stock.size, member.id);
  }
  const poly = applyCuts(stock.size, member.cuts);
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
      stockSize: meshes.get(member.memberId)?.stock.size ?? [0, 0, 0],
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

  const fasteners = [...resolved.fasteners, ...expanded.fasteners];
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
