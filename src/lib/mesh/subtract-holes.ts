import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { faceNormal, type Polyhedron } from "@/lib/geometry";
import type { ResolvedHole } from "@/lib/schema";

const OVERLAP = 0.05;
export const HOLE_SEGMENTS = 16;

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

function holeCutter(hole: ResolvedHole): Brush {
  const inward = new THREE.Vector3(-hole.normal[0], -hole.normal[1], -hole.normal[2]);
  const length = hole.depth + (hole.through ? OVERLAP * 2 : OVERLAP);
  const mid = hole.through ? hole.depth / 2 : (hole.depth - OVERLAP) / 2;
  const geometry = new THREE.CylinderGeometry(hole.diameter / 2, hole.diameter / 2, length, HOLE_SEGMENTS);
  const brush = new Brush(geometry);
  brush.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), inward);
  brush.position.set(
    hole.center[0] + inward.x * mid,
    hole.center[1] + inward.y * mid,
    hole.center[2] + inward.z * mid,
  );
  brush.updateMatrixWorld();
  return brush;
}

/**
 * Subtract each hole from a watertight solid. Returns null when the brush cannot be cut
 * (for example an L-bracket, which is two overlapping boxes).
 */
export function subtractHoles(solid: THREE.BufferGeometry, holes: ResolvedHole[]): THREE.BufferGeometry | null {
  if (holes.length === 0) return solid;

  let welded: THREE.BufferGeometry | null = null;
  let current: Brush | null = null;
  try {
    const weldedMesh = weldByPosition(solid);
    welded = weldedMesh;
    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal"];
    evaluator.useGroups = false;
    let brush = new Brush(weldedMesh);
    brush.updateMatrixWorld();
    current = brush;

    for (const hole of holes) {
      const cutter = holeCutter(hole);
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

    const result = brush.geometry;
    if (weldedMesh !== result) weldedMesh.dispose();
    const position = result.getAttribute("position");
    if (!position || position.count === 0) {
      result.dispose();
      return null;
    }
    return result;
  } catch {
    if (current && welded && current.geometry !== welded) current.geometry.dispose();
    welded?.dispose();
    return null;
  }
}
