import type { SceneConnection } from "./connections";
import type { SceneFastener } from "./fasteners";
import {
  applyPose,
  boundingBox,
  composeEulerXYZ,
  inverseRotateEulerXYZ,
  unapplyPose,
  worldPolyhedron,
  type Vec3,
} from "./geometry";
import type { SceneContacts } from "./geometry";
import {
  findSceneComponent,
  membersUnder,
  sceneMembers,
  type SceneComponent,
  type SceneMemberInstance,
  type SceneModel,
} from "./scene";

const ORIGIN: Vec3 = [0, 0, 0];

export type WorldPose = {
  worldPosition: Vec3;
  worldRotation: Vec3;
};

/** Point in the component frame that lands on `point` in the build. */
export function isolatePoint(point: Vec3, pose: WorldPose): Vec3 {
  return unapplyPose(point, pose.worldPosition, pose.worldRotation);
}

/** Direction in the component frame that points along `direction` in the build. */
export function isolateDirection(direction: Vec3, worldRotation: Vec3): Vec3 {
  return inverseRotateEulerXYZ(direction, worldRotation);
}

/**
 * The occurrence drawn with its origin on the grid.
 * Nested world poses are rebuilt from the children's local poses.
 */
export function isolateComponent(component: SceneComponent): SceneComponent {
  return place(component, ORIGIN, ORIGIN, true);
}

function place(
  component: SceneComponent,
  worldPosition: Vec3,
  worldRotation: Vec3,
  root: boolean,
): SceneComponent {
  const position = root ? ORIGIN : component.position;
  const rotation = root ? ORIGIN : component.rotation;
  const worldPos = root ? ORIGIN : worldPosition;
  const worldRot = root ? ORIGIN : worldRotation;
  return {
    ...component,
    position,
    rotation,
    worldPosition: worldPos,
    worldRotation: worldRot,
    members: component.members.map((member) => poseMember(member, worldPos, worldRot)),
    children: component.children.map((child) =>
      place(child, applyPose(child.position, worldPos, worldRot), composeEulerXYZ(worldRot, child.rotation), false),
    ),
  };
}

function poseMember(member: SceneMemberInstance, worldPosition: Vec3, worldRotation: Vec3): SceneMemberInstance {
  const worldBounds = boundingBox(
    worldPolyhedron(member.faces, member.position, member.rotation, worldPosition, worldRotation),
  );
  const center = midpoint(member.bounds.min, member.bounds.max);
  return {
    ...member,
    worldBounds,
    worldCenter: applyPose(applyPose(center, member.position, member.rotation), worldPosition, worldRotation),
  };
}

function midpoint(min: Vec3, max: Vec3): Vec3 {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

function keysUnder(component: SceneComponent): Set<string> {
  return new Set(membersUnder(component).map((member) => member.key));
}

/** Fasteners whose members all live in the occurrence, moved into its frame. */
export function isolateFasteners(
  fasteners: readonly SceneFastener[],
  component: SceneComponent,
): SceneFastener[] {
  const keys = keysUnder(component);
  const kept: SceneFastener[] = [];
  for (const fastener of fasteners) {
    if (!fastener.members.every((member) => keys.has(member.instanceKey))) continue;
    kept.push({
      ...fastener,
      origin: isolatePoint(fastener.origin, component),
      direction: isolateDirection(fastener.direction, component.worldRotation),
      across: fastener.across ? isolateDirection(fastener.across, component.worldRotation) : undefined,
      members: fastener.members.map((member) => ({
        ...member,
        point: isolatePoint(member.point, component),
        direction: member.direction ? isolateDirection(member.direction, component.worldRotation) : undefined,
      })),
    });
  }
  return kept;
}

/** Connections whose members all live in the occurrence. */
export function isolateConnections(
  connections: readonly SceneConnection[],
  component: SceneComponent,
): SceneConnection[] {
  const keys = keysUnder(component);
  return connections.filter((connection) => connection.memberKeys.every((key) => keys.has(key)));
}

/** Contact patches between members of the occurrence, moved into its frame. */
export function isolateContacts(contacts: SceneContacts, component: SceneComponent): SceneContacts {
  const keys = keysUnder(component);
  const patches = contacts.patches.flatMap((patch) => {
    if (!keys.has(patch.a.instanceKey) || !keys.has(patch.b.instanceKey)) return [];
    return [
      {
        ...patch,
        polygon: patch.polygon.map((point) => isolatePoint(point, component)),
        normal: isolateDirection(patch.normal, component.worldRotation),
      },
    ];
  });
  const patchKeys = new Set(patches.map((patch) => patch.key));
  const hosts = contacts.hosts.flatMap((host) => {
    if (!keys.has(host.instanceKey)) return [];
    return [
      {
        ...host,
        polygon: host.polygon.map((point) => isolatePoint(point, component)),
        normal: isolateDirection(host.normal, component.worldRotation),
        patchKeys: host.patchKeys.filter((key) => patchKeys.has(key)),
      },
    ];
  });
  return { hosts, patches };
}

/** Full scene reduced to one occurrence in its own frame. */
export function isolateScene(scene: SceneModel, occurrenceId: string): SceneModel | null {
  const source = findSceneComponent(scene.components, occurrenceId);
  if (!source) return null;
  const view = isolateComponent(source);
  const centers = sceneMembers([view]).map((member) => member.worldCenter);
  return {
    ...scene,
    components: [view],
    fasteners: isolateFasteners(scene.fasteners, source),
    connections: isolateConnections(scene.connections, source),
    contacts: isolateContacts(scene.contacts, source),
    center: centerOf(centers),
  };
}

function centerOf(points: Vec3[]): Vec3 {
  if (points.length === 0) return ORIGIN;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    min[0] = Math.min(min[0], point[0]);
    min[1] = Math.min(min[1], point[1]);
    min[2] = Math.min(min[2], point[2]);
    max[0] = Math.max(max[0], point[0]);
    max[1] = Math.max(max[1], point[1]);
    max[2] = Math.max(max[2], point[2]);
  }
  return midpoint(min, max);
}
