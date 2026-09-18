import { getCatalogPart, isFlatLBracket, isLBracket, type CatalogPart } from "./catalog";
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
  flatLBracketPolyhedron,
  lBracketPolyhedron,
  polyhedronVolume,
  type Polyhedron,
  type Vec3,
} from "./geometry";
import type { ResolvedCut, ResolvedDocument, ResolvedPart } from "./schema";

export type ScenePartInstance = {
  key: string;
  partId: string;
  label: string;
  stockId: string;
  stockLabel: string;
  material: string;
  color: string;
  faces: Polyhedron;
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
  parts: ScenePartInstance[];
};

export type SceneModel = {
  name: string;
  center: Vec3;
  components: SceneComponent[];
  fasteners: SceneFastener[];
};

export type { SceneFastener, SceneFastenerMember } from "./fasteners";

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
    width: bounds.max[1] - bounds.min[1],
    thickness: bounds.max[2] - bounds.min[2],
  };
}

function assertCutInBounds(cut: ResolvedCut, size: Vec3, partId: string): void {
  const limit = size[cut.axis];
  if (typeof cut.at === "number") {
    if (cut.at < -1e-6 || cut.at > limit + 1e-6) {
      throw new Error(
        `Cut on ${partId} at ${cut.at} is outside stock axis ${cut.axis} (0–${limit})`,
      );
    }
    return;
  }
  const [short, long] = cut.at;
  if (short < -1e-6 || long > limit + 1e-6) {
    throw new Error(
      `Cut on ${partId} [${short}, ${long}] is outside stock axis ${cut.axis} (0–${limit})`,
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

export function meshPart(part: ResolvedPart, stock: CatalogPart): Polyhedron {
  if (isLBracket(stock) || isFlatLBracket(stock)) {
    if (part.cuts.length > 0) {
      throw new Error(`L-bracket ${part.id} cannot take planar cuts`);
    }
    const poly = isFlatLBracket(stock) ? flatLBracketPolyhedron(stock.size) : lBracketPolyhedron(stock.size);
    if (polyhedronVolume(poly) < 1e-6) {
      throw new Error(`L-bracket ${part.id} has no volume`);
    }
    return poly;
  }
  for (const cut of part.cuts) {
    assertCutInBounds(cut, stock.size, part.id);
  }
  const poly = applyCuts(stock.size, part.cuts);
  if (polyhedronVolume(poly) < 1e-6) {
    throw new Error(`Cuts on ${part.id} removed all material`);
  }
  return poly;
}

export function buildScene(document: ResolvedDocument): {
  scene?: SceneModel;
  issues: SceneIssue[];
} {
  const issues: SceneIssue[] = [];
  const meshes = new Map<string, { part: ResolvedPart; stock: CatalogPart; faces: Polyhedron }>();

  for (const [index, part] of document.parts.entries()) {
    const stock = getCatalogPart(part.stock);
    if (!stock) {
      issues.push({
        message: `Unknown stock "${part.stock}"`,
        path: ["parts", index, "stock"],
      });
      continue;
    }
    if (!stock.renderable) {
      issues.push({
        message: `Stock "${part.stock}" is catalogued but not renderable as part stock`,
        path: ["parts", index, "stock"],
      });
      continue;
    }
    try {
      meshes.set(part.id, { part, stock, faces: meshPart(part, stock) });
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: ["parts", index, "cuts"],
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
    parts: component.parts.flatMap((placement, index) => {
      const mesh = meshes.get(placement.part);
      if (!mesh) return [];
      const bounds = boundingBox(mesh.faces);
      return [
        {
          key: instanceKey(component.id, placement.part, index),
          partId: mesh.part.id,
          label: mesh.part.label,
          stockId: mesh.stock.id,
          stockLabel: mesh.stock.label,
          material: mesh.stock.material,
          color: mesh.stock.color,
          faces: mesh.faces,
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

  const errors = issues.filter((issue) => (issue.severity ?? "error") === "error");
  if (errors.length > 0) {
    return { issues };
  }

  const nodes = components.flatMap((component) => component.parts.map((part) => part.key));
  const seed = components[0]?.parts[0]?.key;
  const fastened = fastenedFromSeed(nodes, resolved.edges, seed);

  for (const component of components) {
    for (const part of component.parts) {
      part.fastened = fastened.has(part.key);
    }
  }

  const allParts = components.flatMap((component) => component.parts);
  return {
    scene: {
      name: document.name,
      center: centerFromWorldCenters(allParts.map((part) => part.worldCenter)),
      components,
      fasteners: resolved.fasteners,
    },
    issues,
  };
}
