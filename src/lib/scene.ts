import { getCatalogPart, type CatalogPart } from "./catalog";
import {
  applyCuts,
  boundingBox,
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
  finished: { length: number; width: number; thickness: number };
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
  components: SceneComponent[];
};

export type SceneIssue = {
  message: string;
  path: Array<string | number>;
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

export function meshPart(part: ResolvedPart, stock: CatalogPart): Polyhedron {
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
        message: `Stock "${part.stock}" is catalogued but not renderable in v1`,
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
          key: `${component.id}/${placement.part}#${index}`,
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
          finished: finishedFromBounds(bounds),
        },
      ];
    }),
  }));

  return {
    scene: { name: document.name, components },
    issues,
  };
}
