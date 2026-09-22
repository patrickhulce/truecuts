import * as THREE from "three";
import type { Polyhedron } from "@/lib/geometry";
import type { ResolvedHole } from "@/lib/schema";
import { facesToGeometry, HOLE_SEGMENTS } from "./subtract-holes";

const EDGE_THRESHOLD = 20;

function pushSegment(positions: number[], a: THREE.Vector3, b: THREE.Vector3): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

/** Ring in the face plane. +Y of the cylinder maps onto the inward bore axis. */
function ring(center: THREE.Vector3, inward: THREE.Vector3, radius: number): THREE.Vector3[] {
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), inward);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < HOLE_SEGMENTS; i++) {
    const theta = (i / HOLE_SEGMENTS) * Math.PI * 2;
    const local = new THREE.Vector3(Math.sin(theta) * radius, 0, Math.cos(theta) * radius);
    points.push(local.applyQuaternion(quat).add(center));
  }
  return points;
}

function pushLoop(positions: number[], points: THREE.Vector3[]): void {
  for (let i = 0; i < points.length; i++) {
    pushSegment(positions, points[i], points[(i + 1) % points.length]);
  }
}

/**
 * CAD edges for a part whose mesh has been cut by holes.
 * The outline is the solid before the bores. Each hole adds its mouth, its far end, and the bore lines.
 */
export function partEdgeGeometry(faces: Polyhedron, holes: ResolvedHole[]): THREE.BufferGeometry {
  const solid = facesToGeometry(faces);
  const outline = new THREE.EdgesGeometry(solid, EDGE_THRESHOLD);
  solid.dispose();
  const positions = Array.from(outline.getAttribute("position").array);
  outline.dispose();

  for (const hole of holes) {
    const inward = new THREE.Vector3(-hole.normal[0], -hole.normal[1], -hole.normal[2]).normalize();
    const radius = hole.diameter / 2;
    const mouth = new THREE.Vector3(hole.center[0], hole.center[1], hole.center[2]);
    const far = mouth.clone().addScaledVector(inward, hole.depth);
    const mouthLoop = ring(mouth, inward, radius);
    const farLoop = ring(far, inward, radius);
    pushLoop(positions, mouthLoop);
    pushLoop(positions, farLoop);
    for (let i = 0; i < mouthLoop.length; i++) {
      pushSegment(positions, mouthLoop[i], farLoop[i]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
