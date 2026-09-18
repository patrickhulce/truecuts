"use client";

import { Edges } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { faceNormal, type Polyhedron } from "@/lib/geometry";
import type { ScenePartInstance } from "@/lib/scene";

function facesToGeometry(faces: Polyhedron): THREE.BufferGeometry {
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

type PartMeshProps = {
  instance: ScenePartInstance;
  selected: boolean;
  onSelect: (key: string) => void;
};

export function PartMesh({ instance, selected, onSelect }: PartMeshProps) {
  const geometry = useMemo(() => facesToGeometry(instance.faces), [instance.faces]);
  const rotation: [number, number, number] = [
    THREE.MathUtils.degToRad(instance.rotation[0]),
    THREE.MathUtils.degToRad(instance.rotation[1]),
    THREE.MathUtils.degToRad(instance.rotation[2]),
  ];

  return (
    <mesh
      geometry={geometry}
      position={instance.position}
      rotation={rotation}
      castShadow
      receiveShadow
      onClick={(event) => {
        event.stopPropagation();
        onSelect(instance.key);
      }}
    >
      <meshStandardMaterial
        color={instance.color}
        roughness={0.55}
        metalness={0.04}
        emissive={selected ? "#d97706" : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
      />
      <Edges threshold={20} color={selected ? "#f59e0b" : "#3b2410"} />
    </mesh>
  );
}
