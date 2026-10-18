import { EditError, setComponentPose, setPlacementPose } from "./edit";
import { parseInstanceKey, parseNestedOccurrence } from "./fasteners";
import { add, originCorner, rotateEulerXYZ, translateByWorldDelta, unionAabb, type Vec3 } from "./geometry";
import { isolateScene } from "./isolate";
import { componentIdOfSelection } from "./selection";
import { findSceneComponent, findSceneParent, membersUnder, sceneMembers, type SceneModel } from "./scene";

/** The selection's minimum X/Y/Z corner in the build or current editing frame. */
export function selectionPosition(scene: SceneModel, keys: readonly string[], frameId?: string): Vec3 | null {
  const view = frameId ? isolateScene(scene, frameId) : scene;
  if (!view) return null;
  const selected = new Set(keys);
  for (const key of keys) {
    const id = componentIdOfSelection(key);
    const component = id ? findSceneComponent(view.components, id) : undefined;
    if (component) for (const member of membersUnder(component)) selected.add(member.key);
  }
  const bounds = unionAabb(sceneMembers(view.components).filter((member) => selected.has(member.key)).map((member) => member.worldBounds));
  return bounds ? originCorner(bounds, [0, 0, 0], [0, 0, 0]) : null;
}

/** Translate the selection once, keeping rotations, relative spacing, and connections. */
export function setSelectionPosition(
  text: string,
  scene: SceneModel,
  keys: readonly string[],
  axis: 0 | 1 | 2,
  inches: number,
  frameId?: string,
): string {
  if (!Number.isFinite(inches)) throw new EditError("Position must be finite");
  const corner = selectionPosition(scene, keys, frameId);
  if (!corner) throw new EditError("Select members or a component to position");
  const delta: Vec3 = [0, 0, 0];
  delta[axis] = inches - corner[axis];
  if (Math.abs(delta[axis]) < 1e-8) return text;
  const frame = frameId ? findSceneComponent(scene.components, frameId) : undefined;
  const worldDelta = frame ? rotateEulerXYZ(delta, frame.worldRotation) : delta;
  const components = [...new Set(keys.flatMap((key) => {
    const id = componentIdOfSelection(key);
    return id ? [id] : [];
  }))];
  const covered = (id: string) => components.some((parent) => id.startsWith(`${parent}/`));
  const updates = new Map<string, { delta: Vec3; apply: (text: string) => string }>();
  const linkedError = "These linked placements cannot move together independently. Unlink them before moving this selection together.";
  function componentSlot(id: string): string {
    const nested = parseNestedOccurrence(id);
    const parent = findSceneParent(scene.components, id);
    return nested && parent ? `component:${parent.templateId}/${nested.templateId}#${nested.index}` : `root:${id}`;
  }
  function addUpdate(slot: string, localDelta: Vec3, apply: (text: string) => string) {
    const previous = updates.get(slot);
    if (previous && previous.delta.some((value, index) => Math.abs(value - localDelta[index]) > 1e-6)) {
      throw new EditError(linkedError);
    }
    if (!previous) updates.set(slot, { delta: localDelta, apply });
  }
  for (const id of components) {
    if (covered(id)) continue;
    const component = findSceneComponent(scene.components, id);
    if (!component) throw new EditError(`Unknown component "${id}"`);
    const parent = findSceneParent(scene.components, id);
    const localDelta = translateByWorldDelta([0, 0, 0], parent?.worldRotation ?? [0, 0, 0], worldDelta);
    addUpdate(componentSlot(id), localDelta, (current) => setComponentPose(current, id, add(component.position, localDelta), component.rotation));
  }
  const selected = new Set(keys);
  for (const member of sceneMembers(scene.components)) {
    if (!selected.has(member.key) || covered(member.key)) continue;
    const { componentId, placementIndex } = parseInstanceKey(member.key);
    const owner = findSceneComponent(scene.components, componentId)!;
    const localDelta = translateByWorldDelta([0, 0, 0], owner.worldRotation, worldDelta);
    addUpdate(`member:${owner.templateId}#${placementIndex}`, localDelta,
      (current) => setPlacementPose(current, componentId, placementIndex, add(member.position, localDelta), member.rotation));
  }
  // A template edit can also affect members covered by another selected group.
  // Check the combined displacement before writing so shared links cannot distort the selection.
  for (const member of sceneMembers(scene.components)) {
    if (!selected.has(member.key) && !covered(member.key)) continue;
    const { componentId, placementIndex } = parseInstanceKey(member.key);
    const owner = findSceneComponent(scene.components, componentId)!;
    const memberUpdate = updates.get(`member:${owner.templateId}#${placementIndex}`);
    let movement: Vec3 = memberUpdate ? rotateEulerXYZ(memberUpdate.delta, owner.worldRotation) : [0, 0, 0];
    let component = owner;
    while (component) {
      const update = updates.get(componentSlot(component.id));
      const parent = findSceneParent(scene.components, component.id);
      if (update) movement = add(movement, rotateEulerXYZ(update.delta, parent?.worldRotation ?? [0, 0, 0]));
      if (!parent) break;
      component = parent;
    }
    if (movement.some((value, index) => Math.abs(value - worldDelta[index]) > 1e-6)) throw new EditError(linkedError);
  }
  let next = text;
  for (const update of updates.values()) next = update.apply(next);
  return next;
}
