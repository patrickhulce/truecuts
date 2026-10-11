import { getCatalogPart, stockGeometry, type CatalogPart, type StockGeometry } from "./catalog";
import { expandConnections, rayFaceDistance, type ConnectionSolid, type SceneConnection } from "./connections";
import {
  cliqueEdges,
  fastenedFromSeed,
  instanceKey,
  realizeFastener,
  worldDirection,
  worldPoint,
  type FastenerIssue,
  type FastenerSite,
  type SceneFastener,
} from "./fasteners";
import {
  applyCuts,
  applyPose,
  boundingBox,
  clipPolyhedron,
  composeEulerXYZ,
  cutToPlane,
  findContacts,
  flatLBracketPolyhedron,
  joistHangerPolyhedron,
  lBracketPolyhedron,
  normalize,
  polyhedronVolume,
  rodPolyhedron,
  saddlePolyhedron,
  scale,
  tConnectorPolyhedron,
  uBarPolyhedron,
  worldPolyhedron,
  type Polyhedron,
  type SceneContacts,
  type Vec3,
} from "./geometry";
import type {
  ResolvedBore,
  ResolvedComponent,
  ResolvedCut,
  ResolvedDocument,
  ResolvedFastenerMember,
  ResolvedMember,
} from "./schema";

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
  /** Occurrence id. A root uses its document id; a nested copy is `parent/templateId#index`. */
  id: string;
  /** Component definition this occurrence was built from. */
  templateId: string;
  label: string;
  /** Occurrence of `templateId` among its siblings. */
  index: number;
  /** Pose in the parent. For a root this is the world pose. */
  position: Vec3;
  rotation: Vec3;
  worldPosition: Vec3;
  worldRotation: Vec3;
  members: SceneMemberInstance[];
  children: SceneComponent[];
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
      component.worldPosition,
      component.worldRotation,
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
  for (const part of sceneMembers(scene.components)) {
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
  return map;
}

export function walkSceneComponents(
  components: SceneComponent[],
  visit: (component: SceneComponent) => void,
): void {
  for (const component of components) {
    visit(component);
    walkSceneComponents(component.children, visit);
  }
}

export function sceneMembers(components: SceneComponent[]): SceneMemberInstance[] {
  const members: SceneMemberInstance[] = [];
  walkSceneComponents(components, (component) => {
    members.push(...component.members);
  });
  return members;
}

export function findSceneComponent(components: SceneComponent[], id: string): SceneComponent | undefined {
  let found: SceneComponent | undefined;
  walkSceneComponents(components, (component) => {
    if (!found && component.id === id) found = component;
  });
  return found;
}

/** Direct members, then members of nested occurrences. */
export function membersUnder(component: SceneComponent): SceneMemberInstance[] {
  const members = [...component.members];
  for (const child of component.children) members.push(...membersUnder(child));
  return members;
}

/** Parent occurrence, or null when `id` is a root. Undefined when `id` is not in the tree. */
export function findSceneParent(components: SceneComponent[], id: string): SceneComponent | null | undefined {
  let parent: SceneComponent | null | undefined;
  const walk = (list: SceneComponent[], owner: SceneComponent | null): void => {
    for (const component of list) {
      if (component.id === id) {
        parent = owner;
        return;
      }
      walk(component.children, component);
      if (parent !== undefined) return;
    }
  };
  walk(components, null);
  return parent;
}

const GEOMETRY_LABEL: Record<Exclude<StockGeometry, "box" | "rod">, string> = {
  "bracket-l": "L-bracket",
  "bracket-flat-l": "Flat L-bracket",
  "connector-t": "T-connector",
  saddle: "Saddle",
  "joist-hanger": "Joist hanger",
  "u-bar": "Monkey bar",
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
    case "joist-hanger":
      return joistHangerPolyhedron(
        member.size,
        featureHeight(member, "height", label),
        featureHeight(member, "face", label),
      );
    case "u-bar":
      return uBarPolyhedron(member.size, featureHeight(member, "drop", label), featureHeight(member, "flange", label));
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

  const definitions = new Map(
    document.components.filter((component) => !component.of).map((component) => [component.id, component]),
  );
  const components: SceneComponent[] = [];
  for (const component of document.components) {
    const template = component.of ? definitions.get(component.of) : component;
    if (!template || !component.position) continue;
    components.push(
      buildOccurrence(
        template,
        component.id,
        0,
        component.position,
        component.rotation,
        component.position,
        component.rotation,
        meshes,
        definitions,
      ),
    );
  }

  const posed: Array<{ member: SceneMemberInstance; component: SceneComponent }> = [];
  walkSceneComponents(components, (component) => {
    for (const member of component.members) posed.push({ member, component });
  });

  const templateIndex = new Map(document.components.map((component, index) => [component.id, index]));
  const fasteners: SceneFastener[] = [];
  const edges: Array<[string, string]> = [];
  const fastenerIssues: FastenerIssue[] = [];
  walkSceneComponents(components, (occurrence) => {
    const template = definitions.get(occurrence.templateId);
    if (!template) return;
    const cIndex = templateIndex.get(template.id) ?? 0;
    for (const [fIndex, fastener] of template.fasteners.entries()) {
      const realized = realizeFastener(
        fastener,
        ["components", cIndex, "fasteners", fIndex],
        `${occurrence.id}/fastener#${fIndex}`,
        (member) => locateInOccurrence(occurrence, member),
        fastenerIssues,
      );
      if (!realized) continue;
      fasteners.push(realized.scene);
      edges.push(...cliqueEdges(realized.memberKeys));
    }
  });
  for (const [fIndex, fastener] of document.fasteners.entries()) {
    const realized = realizeFastener(
      fastener,
      ["fasteners", fIndex],
      `fastener#${fIndex}`,
      (member) => {
        const owner = findSceneComponent(components, member.component);
        return owner ? siteOf(owner, member) : undefined;
      },
      fastenerIssues,
    );
    if (!realized) continue;
    fasteners.push(realized.scene);
    edges.push(...cliqueEdges(realized.memberKeys));
  }

  issues.push(...fastenerIssues);

  const explicitErrors = issues.filter((issue) => (issue.severity ?? "error") === "error");
  if (explicitErrors.length > 0) {
    return { issues };
  }

  const contacts = findContacts(
    posed.map(({ member, component }) => ({
      key: member.key,
      faces: member.faces,
      position: member.position,
      rotation: member.rotation,
      componentPosition: component.worldPosition,
      componentRotation: component.worldRotation,
      bounds: member.bounds,
    })),
  );

  const solids: ConnectionSolid[] = posed.map(({ member, component }) => ({
    key: member.key,
    memberId: member.memberId,
    faces: member.faces,
    position: member.position,
    rotation: member.rotation,
    componentId: component.id,
    componentPosition: component.worldPosition,
    componentRotation: component.worldRotation,
    stockSize: meshes.get(member.memberId)?.member.size ?? [0, 0, 0],
    stockId: meshes.get(member.memberId)?.stock.id ?? "",
  }));
  const occurrences = [] as Array<{ id: string; templateId: string; path: Array<string | number> }>;
  walkSceneComponents(components, (occurrence) => {
    occurrences.push({
      id: occurrence.id,
      templateId: occurrence.templateId,
      path: ["components", templateIndex.get(occurrence.templateId) ?? 0],
    });
  });
  const expanded = expandConnections(document, solids, contacts, occurrences);
  issues.push(...expanded.issues);

  const errors = issues.filter((issue) => (issue.severity ?? "error") === "error");
  if (errors.length > 0) {
    return { issues };
  }

  const byKey = new Map(posed.map(({ member }) => [member.key, member]));
  for (const derived of expanded.bores) {
    byKey.get(derived.instanceKey)?.derivedBores.push(derived.bore);
  }

  const componentOf = new Map(posed.map(({ member, component }) => [member.key, component] as const));
  const sceneFasteners = [...fasteners, ...expanded.fasteners].map((fastener) => ({
    ...fastener,
    ...(fastener.subtype === "screw" || fastener.subtype === "nail"
      ? { headCovered: screwHeadCovered(fastener, byKey, componentOf) }
      : {}),
  }));
  const allEdges = [...edges, ...expanded.edges];
  const nodes = posed.map(({ member }) => member.key);
  const fastened = fastenedFromSeed(nodes, allEdges, nodes[0]);

  for (const { member } of posed) {
    member.fastened = fastened.has(member.key);
  }

  return {
    scene: {
      name: document.name,
      center: centerFromWorldCenters(posed.map(({ member }) => member.worldCenter)),
      components,
      fasteners: sceneFasteners,
      contacts,
      connections: expanded.connections,
    },
    issues,
  };
}

type MemberMesh = { member: ResolvedMember; stock: CatalogPart; faces: Polyhedron };

function buildOccurrence(
  template: ResolvedComponent,
  occurrenceId: string,
  index: number,
  position: Vec3,
  rotation: Vec3,
  worldPosition: Vec3,
  worldRotation: Vec3,
  meshes: Map<string, MemberMesh>,
  definitions: Map<string, ResolvedComponent>,
): SceneComponent {
  const world = { position: worldPosition, rotation: worldRotation };
  const members: SceneMemberInstance[] = template.members.flatMap((placement, placementIndex) => {
    const mesh = meshes.get(placement.id);
    if (!mesh) return [];
    const bounds = boundingBox(mesh.faces);
    const worldBounds = boundingBox(
      worldPolyhedron(mesh.faces, placement.position, placement.rotation, worldPosition, worldRotation),
    );
    return [
      {
        key: instanceKey(occurrenceId, placement.id, placementIndex),
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
        worldCenter: worldPoint(midpoint(bounds.min, bounds.max), placement, world),
        finished: finishedFromBounds(bounds),
        fastened: false,
      },
    ];
  });

  const seen = new Map<string, number>();
  const children: SceneComponent[] = [];
  for (const placement of template.components) {
    const childTemplate = definitions.get(placement.component);
    if (!childTemplate) continue;
    const childIndex = seen.get(placement.component) ?? 0;
    seen.set(placement.component, childIndex + 1);
    const childWorldPosition = applyPose(placement.position, worldPosition, worldRotation);
    const childWorldRotation = composeEulerXYZ(worldRotation, placement.rotation);
    children.push(
      buildOccurrence(
        childTemplate,
        `${occurrenceId}/${placement.component}#${childIndex}`,
        childIndex,
        placement.position,
        placement.rotation,
        childWorldPosition,
        childWorldRotation,
        meshes,
        definitions,
      ),
    );
  }

  return {
    id: occurrenceId,
    templateId: template.id,
    label: template.label,
    index,
    position,
    rotation,
    worldPosition,
    worldRotation,
    members,
    children,
  };
}

function siteOf(owner: SceneComponent, member: ResolvedFastenerMember): FastenerSite | undefined {
  let seen = 0;
  const pose = { position: owner.worldPosition, rotation: owner.worldRotation };
  for (const placed of owner.members) {
    if (placed.memberId !== member.id) continue;
    if (seen === member.index) {
      return {
        instanceKey: placed.key,
        point: worldPoint(member.at, placed, pose),
        direction: member.direction ? normalize(worldDirection(member.direction, placed, pose)) : undefined,
      };
    }
    seen += 1;
  }
  return undefined;
}

function locateInOccurrence(occurrence: SceneComponent, member: ResolvedFastenerMember): FastenerSite | undefined {
  if (member.nest === undefined) return siteOf(occurrence, member);
  const child = occurrence.children.find(
    (entry) => entry.templateId === member.component && entry.index === member.nest,
  );
  return child ? siteOf(child, member) : undefined;
}
