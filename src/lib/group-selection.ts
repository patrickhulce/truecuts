import { groupMembers } from "./edit";
import { parseInstanceKey } from "./fasteners";
import { groupOrigin, placementAfterReseat, placementInNewGroup, worldPlacementPose } from "./geometry";
import { walkSceneComponents, type SceneComponent, type SceneMemberInstance, type SceneModel } from "./scene";

export function groupFromSelection(text: string, scene: SceneModel, keys: string[]) {
  const selected = new Set(keys);
  const byKey = new Map<string, { part: SceneMemberInstance; component: SceneComponent }>();
  walkSceneComponents(scene.components, (component) => {
    for (const part of component.members) byKey.set(part.key, { part, component });
  });
  const ordered = keys.flatMap((key) => {
    const hit = byKey.get(key);
    return hit ? [hit] : [];
  });
  if (ordered.length === 0) return null;
  const origin = groupOrigin(ordered.map(({ part }) => part.worldBounds));
  if (!origin) return null;
  const sole = new Set(ordered.map(({ component }) => component.id)).size === 1 ? ordered[0].component : null;
  const entire = Boolean(
    sole && sole.members.length === ordered.length && sole.members.every((member) => selected.has(member.key)),
  );
  const reseat = Boolean(entire && sole && sole.id === sole.templateId && sole.children.length === 0);
  const items = ordered.map(({ part, component }) => {
    const world = worldPlacementPose(
      { position: part.position, rotation: part.rotation },
      { position: component.worldPosition, rotation: component.worldRotation },
    );
    const { placementIndex } = parseInstanceKey(part.key);
    const componentId = component.templateId;
    if (reseat) {
      return {
        componentId,
        placementIndex,
        position: placementAfterReseat(world.position, origin, component.worldRotation),
        rotation: part.rotation,
      };
    }
    const local = placementInNewGroup(world, origin);
    return { componentId, placementIndex, position: local.position, rotation: local.rotation };
  });
  return groupMembers(text, items, origin, reseat ? sole!.id : undefined);
}

