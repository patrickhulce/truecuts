import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { faceNormal, type Polyhedron } from "@/lib/geometry";
import type { ResolvedBore } from "@/lib/schema";

const OVERLAP = 0.05;
export const HOLE_SEGMENTS = 16;

/** Cut meshes kept so an unchanged member is not booleaned again. Callers receive a clone. */
const CUT_CACHE_LIMIT = 32;
const cutCache = new Map<string, THREE.BufferGeometry>();

export function facesToGeometry(faces: Polyhedron): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    const normal = faceNormal(face);
    for (let i = 1; i < face.length - 1; i++) {
      for (const vertex of [face[0], face[i], face[i + 1]]) {
        positions.push(vertex[0], vertex[1], vertex[2]);
        normals.push(normal[0], normal[1], normal[2]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** Weld coincident corners so a triangle-soup box is a watertight brush. */
function weldByPosition(solid: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", solid.getAttribute("position").clone());
  const welded = mergeVertices(geometry);
  geometry.dispose();
  welded.computeVertexNormals();
  return welded;
}

function makeEvaluator(): Evaluator {
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];
  evaluator.useGroups = false;
  return evaluator;
}

function borePose(bore: ResolvedBore): {
  geometry: THREE.CylinderGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
} {
  const inward = new THREE.Vector3(-bore.normal[0], -bore.normal[1], -bore.normal[2]);
  const length = bore.depth + (bore.through ? OVERLAP * 2 : OVERLAP);
  const mid = bore.through ? bore.depth / 2 : (bore.depth - OVERLAP) / 2;
  const geometry = new THREE.CylinderGeometry(bore.diameter / 2, bore.diameter / 2, length, HOLE_SEGMENTS);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), inward);
  const position = new THREE.Vector3(
    bore.center[0] + inward.x * mid,
    bore.center[1] + inward.y * mid,
    bore.center[2] + inward.z * mid,
  );
  return { geometry, position, quaternion };
}

function boreCutter(bore: ResolvedBore): Brush {
  const { geometry, position, quaternion } = borePose(bore);
  const brush = new Brush(geometry);
  brush.quaternion.copy(quaternion);
  brush.position.copy(position);
  brush.updateMatrixWorld();
  return brush;
}

/** Cylinder in the bore's pose, so several cutters can share one brush. */
function boreCutterGeometry(bore: ResolvedBore): THREE.BufferGeometry {
  const { geometry, position, quaternion } = borePose(bore);
  geometry.applyMatrix4(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1)));
  return geometry;
}

function takeResult(welded: THREE.BufferGeometry, result: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (welded !== result) welded.dispose();
  const position = result.getAttribute("position");
  if (!position || position.count === 0) {
    result.dispose();
    return null;
  }
  return result;
}

/**
 * Subtract every bore in one boolean. Returns null when the merged cutter cannot be built
 * or the cut comes back empty, so the caller can fall back to one bore at a time.
 */
function subtractMerged(solid: THREE.BufferGeometry, bores: ResolvedBore[]): THREE.BufferGeometry | null {
  const parts = bores.map(boreCutterGeometry);
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) return null;

  const welded = weldByPosition(solid);
  try {
    const brush = new Brush(welded);
    brush.updateMatrixWorld();
    const cutter = new Brush(merged);
    cutter.updateMatrixWorld();
    const next: Brush = makeEvaluator().evaluate(brush, cutter, SUBTRACTION);
    return takeResult(welded, next.geometry);
  } catch {
    welded.dispose();
    return null;
  } finally {
    merged.dispose();
  }
}

function subtractSequential(solid: THREE.BufferGeometry, bores: ResolvedBore[]): THREE.BufferGeometry | null {
  let welded: THREE.BufferGeometry | null = null;
  let current: Brush | null = null;
  try {
    const weldedMesh = weldByPosition(solid);
    welded = weldedMesh;
    const evaluator = makeEvaluator();
    let brush = new Brush(weldedMesh);
    brush.updateMatrixWorld();
    current = brush;

    for (const bore of bores) {
      const cutter = boreCutter(bore);
      try {
        const next: Brush = evaluator.evaluate(brush, cutter, SUBTRACTION);
        if (brush.geometry !== weldedMesh && brush.geometry !== next.geometry) {
          brush.geometry.dispose();
        }
        brush = next;
        current = brush;
      } finally {
        cutter.geometry.dispose();
      }
    }

    return takeResult(weldedMesh, brush.geometry);
  } catch {
    if (current && welded && current.geometry !== welded) current.geometry.dispose();
    welded?.dispose();
    return null;
  }
}

/**
 * Subtract each hole from a watertight solid. Returns null when the brush cannot be cut
 * (for example an L-bracket, which is two overlapping boxes).
 */
export function subtractBores(solid: THREE.BufferGeometry, bores: ResolvedBore[]): THREE.BufferGeometry | null {
  if (bores.length === 0) return solid;
  if (bores.length > 1) {
    const merged = subtractMerged(solid, bores);
    if (merged) return merged;
  }
  return subtractSequential(solid, bores);
}

function cutCacheKey(faces: Polyhedron, bores: ResolvedBore[]): string {
  const holes = bores.map((bore) => [bore.face, bore.at[0], bore.at[1], bore.diameter, bore.depth, bore.through]);
  return JSON.stringify([faces, holes]);
}

function rememberCut(key: string, geometry: THREE.BufferGeometry): void {
  const previous = cutCache.get(key);
  if (previous && previous !== geometry) previous.dispose();
  cutCache.delete(key);
  cutCache.set(key, geometry);
  while (cutCache.size > CUT_CACHE_LIMIT) {
    const oldest = cutCache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    cutCache.get(oldest)?.dispose();
    cutCache.delete(oldest);
  }
}

/**
 * Solid with the given bores cut out. A repeated faces-and-bores pair clones the cached mesh
 * instead of running CSG again. The caller owns the returned geometry and may dispose it.
 */
export function drilledMemberGeometry(
  faces: Polyhedron,
  bores: ResolvedBore[],
): { geometry: THREE.BufferGeometry; cut: boolean } {
  if (bores.length === 0) return { geometry: facesToGeometry(faces), cut: false };

  const key = cutCacheKey(faces, bores);
  const cached = cutCache.get(key);
  if (cached) {
    cutCache.delete(key);
    cutCache.set(key, cached);
    return { geometry: cached.clone(), cut: true };
  }

  const solid = facesToGeometry(faces);
  const cut = subtractBores(solid, bores);
  if (!cut || cut === solid) return { geometry: solid, cut: false };
  solid.dispose();
  rememberCut(key, cut);
  return { geometry: cut.clone(), cut: true };
}
