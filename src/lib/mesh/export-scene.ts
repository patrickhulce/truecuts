import * as THREE from "three";
import { degToRad } from "@/lib/geometry";
import type { SceneModel } from "@/lib/scene";
import { fastenerQuaternion, fastenerSolid, type FastenerPiece } from "./fastener-solids";
import { drilledMemberGeometry, facesToGeometry } from "./subtract-holes";

/** glTF linear distances are meters. Scene geometry is inches. */
export const INCHES_TO_METERS = 0.0254;

export function sceneHasExportableSolids(scene: SceneModel): boolean {
  if (scene.components.some((component) => component.members.length > 0)) return true;
  return scene.fasteners.some((fastener) => fastenerSolid(fastener) !== null);
}

/** Assembled build in meters. The caller owns the geometries and materials. */
export function buildExportObject(scene: SceneModel): THREE.Group {
  const root = new THREE.Group();
  root.name = scene.name;
  root.scale.setScalar(INCHES_TO_METERS);
  root.userData = { sourceUnits: "inches", units: "meters" };

  const componentNames = new Map<string, number>();
  for (const component of scene.components) {
    const group = new THREE.Group();
    group.name = uniqueName(component.label, componentNames);
    group.position.set(component.position[0], component.position[1], component.position[2]);
    group.rotation.set(
      degToRad(component.rotation[0]),
      degToRad(component.rotation[1]),
      degToRad(component.rotation[2]),
    );

    const memberNames = new Map<string, number>();
    for (const member of component.members) {
      const drilled = drilledMemberGeometry(member.faces, [...member.bores, ...member.derivedBores]);
      const mesh = new THREE.Mesh(
        drilled.geometry,
        new THREE.MeshStandardMaterial({ color: member.color, roughness: 0.8, metalness: 0 }),
      );
      mesh.name = uniqueName(member.label, memberNames);
      mesh.position.set(member.position[0], member.position[1], member.position[2]);
      mesh.rotation.set(degToRad(member.rotation[0]), degToRad(member.rotation[1]), degToRad(member.rotation[2]));
      group.add(mesh);
    }
    root.add(group);
  }

  const fastenerNames = new Map<string, number>();
  for (const fastener of scene.fasteners) {
    const solid = fastenerSolid(fastener);
    if (!solid) continue;
    const group = new THREE.Group();
    group.name = uniqueName(fastener.stockLabel, fastenerNames);
    group.position.set(fastener.origin[0], fastener.origin[1], fastener.origin[2]);
    group.quaternion.copy(fastenerQuaternion(solid.direction, solid.across));
    const material = new THREE.MeshStandardMaterial({
      color: fastener.color,
      metalness: 0.72,
      roughness: 0.28,
    });
    for (const piece of solid.pieces) {
      const mesh = new THREE.Mesh(pieceGeometry(piece), material);
      mesh.position.set(piece.position[0], piece.position[1], piece.position[2]);
      group.add(mesh);
    }
    root.add(group);
  }

  return root;
}

export async function sceneToGlb(scene: SceneModel): Promise<ArrayBuffer> {
  const root = buildExportObject(scene);
  try {
    const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
    const exporter = new GLTFExporter();
    const data = await exporter.parseAsync(root, { binary: true });
    if (!(data instanceof ArrayBuffer)) {
      throw new Error("Expected a binary glTF file");
    }
    return data;
  } finally {
    disposeExportObject(root);
  }
}

function pieceGeometry(piece: FastenerPiece): THREE.BufferGeometry {
  if (piece.kind === "cylinder") {
    return new THREE.CylinderGeometry(piece.radiusTop, piece.radiusBottom, piece.height, piece.segments);
  }
  return facesToGeometry(piece.faces);
}

function uniqueName(name: string, used: Map<string, number>): string {
  const count = used.get(name) ?? 0;
  used.set(name, count + 1);
  return count === 0 ? name : `${name} ${count + 1}`;
}

function disposeExportObject(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) {
      for (const item of material) materials.add(item);
    } else {
      materials.add(material);
    }
  });
  for (const material of materials) material.dispose();
}
