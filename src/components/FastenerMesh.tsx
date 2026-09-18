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

function Steel({ color, highlighted }: { color: string; highlighted?: boolean }) {
  return (
    <meshStandardMaterial
      color={color}
      metalness={0.72}
      roughness={0.28}
      emissive={highlighted ? "#f59e0b" : "#000000"}
      emissiveIntensity={highlighted ? 0.7 : 0}
    />
  );
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function ScrewMesh({
  fastener,
  highlighted,
  offset,
}: {
  fastener: SceneFastener;
  highlighted: boolean;
  offset: Vec3;
}) {
  const quaternion = useMemo(() => lookAlongY(fastener.direction), [fastener.direction]);
  const shankR = Math.max(fastener.diameter / 2, 0.04);
  const headR = shankR * 1.7;
  const headH = Math.min(0.12, fastener.length * 0.12);
  const shankH = Math.max(fastener.length - headH, 0.1);
  return (
    <group position={add(fastener.origin, offset)} quaternion={quaternion}>
      <mesh position={[0, headH / 2, 0]} castShadow>
        <cylinderGeometry args={[headR, headR * 0.82, headH, 16]} />
        <Steel color={fastener.color} highlighted={highlighted} />
      </mesh>
      <mesh position={[0, headH + shankH / 2, 0]} castShadow>
        <cylinderGeometry args={[shankR * 0.45, shankR, shankH, 12]} />
        <Steel color={fastener.color} highlighted={highlighted} />
      </mesh>
    </group>
  );
}

function GlueMesh({
  fastener,
  highlighted,
  offset,
}: {
  fastener: SceneFastener;
  highlighted: boolean;
  offset: Vec3;
}) {
  const radius = Math.max(fastener.diameter / 2, 0.22);
  return (
    <group>
      {fastener.members.map((member, index) => {
        const dir = member.direction ?? fastener.direction;
        return (
          <mesh
            key={`${fastener.key}-glue-${index}`}
            position={add(member.point, offset)}
            quaternion={lookAlongY(dir)}
            renderOrder={2}
          >
            <cylinderGeometry args={[radius, radius, 0.06, 20]} />
            <meshStandardMaterial
              color={fastener.color}
              roughness={0.35}
              metalness={0}
              transparent
              opacity={highlighted ? 0.95 : 0.72}
              depthWrite={false}
              emissive={highlighted ? "#f59e0b" : "#000000"}
              emissiveIntensity={highlighted ? 0.7 : 0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

const ZERO: Vec3 = [0, 0, 0];

export function FastenerMesh({
  fastener,
  highlighted = false,
  offset = ZERO,
}: {
  fastener: SceneFastener;
  highlighted?: boolean;
  offset?: Vec3;
}) {
  if (fastener.subtype === "glue") {
    return <GlueMesh fastener={fastener} highlighted={highlighted} offset={offset} />;
  }
  return <ScrewMesh fastener={fastener} highlighted={highlighted} offset={offset} />;
}
