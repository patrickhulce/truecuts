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

function stripeCacheKey(): string {
  return "unfastened-stripes";
}

function applyStripeShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       varying vec3 vWorldStripe;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
       vWorldStripe = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
       varying vec3 vWorldStripe;`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       float stripe = step(0.5, fract((vWorldStripe.x + vWorldStripe.y) * 0.45));
       diffuseColor.rgb = mix(vec3(1.0), vec3(0.86, 0.12, 0.12), stripe);`,
    );
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
      {instance.fastened ? (
        <meshStandardMaterial
          color={instance.color}
          roughness={0.55}
          metalness={0.04}
          emissive={selected ? "#d97706" : "#000000"}
          emissiveIntensity={selected ? 0.35 : 0}
        />
      ) : (
        <meshStandardMaterial
          key="stripes"
          color="#ffffff"
          roughness={0.45}
          metalness={0.04}
          emissive={selected ? "#d97706" : "#000000"}
          emissiveIntensity={selected ? 0.25 : 0}
          onBeforeCompile={applyStripeShader}
          customProgramCacheKey={stripeCacheKey}
        />
      )}
      <Edges threshold={20} color={selected ? "#f59e0b" : instance.fastened ? "#3b2410" : "#7f1d1d"} />
    </mesh>
  );
}
