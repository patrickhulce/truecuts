import { resolveStockSize, type CatalogPart } from "./catalog";
import { boundingBox, type Vec3 } from "./geometry";
import type { ResolvedCut, ResolvedMember } from "./schema";
import { meshMember, type SceneMemberInstance } from "./scene";

/** A member instance for a catalog thumbnail: unplaced, uncut except an optional square crosscut on L. */
export function catalogMemberInstance(
  part: CatalogPart,
  options?: { size?: number[]; cutAt?: number },
): SceneMemberInstance {
  const resolved = resolveStockSize(part, options?.size);
  const cuts: ResolvedCut[] = [];
  const cutAt = options?.cutAt;
  if (cutAt !== undefined && cutAt > 0 && cutAt < resolved.size[0] - 1e-6) {
    cuts.push({ axis: 0, angle: 90, at: cutAt, side: "end" });
  }
  const member: ResolvedMember = {
    id: "preview",
    label: part.label,
    stock: part.id,
    size: resolved.size,
    features: resolved.features,
    cuts,
    bores: [],
  };
  const faces = meshMember(member, part);
  const bounds = boundingBox(faces);
  const worldCenter: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  return {
    key: part.id,
    memberId: part.id,
    label: part.label,
    stockId: part.id,
    stockLabel: part.label,
    material: part.material,
    color: part.color,
    faces,
    bores: [],
    derivedBores: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    bounds,
    worldBounds: bounds,
    worldCenter,
    finished: {
      length: bounds.max[0] - bounds.min[0],
      width: bounds.max[2] - bounds.min[2],
      thickness: bounds.max[1] - bounds.min[1],
    },
    fastened: true,
  };
}
