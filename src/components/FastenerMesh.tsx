"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "@/lib/geometry";
import type { SceneFastener } from "@/lib/scene";

function lookAlongY(direction: Vec3): THREE.Quaternion {
  const dir = new THREE.Vector3(direction[0], direction[1], direction[2]);
  if (dir.lengthSq() < 1e-10) return new THREE.Quaternion();
  dir.normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

function Steel({ color }: { color: string }) {
  return <meshStandardMaterial color={color} metalness={0.72} roughness={0.28} />;
}

function ScrewMesh({ fastener }: { fastener: SceneFastener }) {
  const quaternion = useMemo(() => lookAlongY(fastener.direction), [fastener.direction]);
  const shankR = Math.max(fastener.diameter / 2, 0.04);
  const headR = shankR * 1.7;
  const headH = Math.min(0.12, fastener.length * 0.12);
  const shankH = Math.max(fastener.length - headH, 0.1);
  return (
    <group position={fastener.origin} quaternion={quaternion}>
      <mesh position={[0, headH / 2, 0]} castShadow>
        <cylinderGeometry args={[headR, headR * 0.82, headH, 16]} />
        <Steel color={fastener.color} />
      </mesh>
      <mesh position={[0, headH + shankH / 2, 0]} castShadow>
        <cylinderGeometry args={[shankR * 0.45, shankR, shankH, 12]} />
        <Steel color={fastener.color} />
      </mesh>
    </group>
  );
}

function GlueMesh({ fastener }: { fastener: SceneFastener }) {
  const radius = Math.max(fastener.diameter / 2, 0.22);
  return (
    <group>
      {fastener.members.map((member, index) => {
        const dir = member.direction ?? fastener.direction;
        return (
          <mesh key={`${fastener.key}-glue-${index}`} position={member.point} quaternion={lookAlongY(dir)} renderOrder={2}>
            <cylinderGeometry args={[radius, radius, 0.06, 20]} />
            <meshStandardMaterial
              color={fastener.color}
              roughness={0.35}
              metalness={0}
              transparent
              opacity={0.72}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export function FastenerMesh({ fastener }: { fastener: SceneFastener }) {
  if (fastener.subtype === "glue") return <GlueMesh fastener={fastener} />;
  return <ScrewMesh fastener={fastener} />;
}
