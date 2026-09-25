"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "@/lib/geometry";
import type { SceneFastener } from "@/lib/scene";
import { applyScrewStripeShader, screwStripeCacheKey } from "./stripeMaterial";

function lookAlongY(direction: Vec3): THREE.Quaternion {
  const dir = new THREE.Vector3(direction[0], direction[1], direction[2]);
  if (dir.lengthSq() < 1e-10) return new THREE.Quaternion();
  dir.normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

function Steel({
  color,
  highlighted,
  striped,
}: {
  color: string;
  highlighted?: boolean;
  striped?: boolean;
}) {
  const showHighlight = highlighted && !striped;
  return (
    <meshStandardMaterial
      color={striped ? "#ffffff" : color}
      metalness={striped ? 0.04 : 0.72}
      roughness={striped ? 0.45 : 0.28}
      emissive={showHighlight ? "#f59e0b" : "#000000"}
      emissiveIntensity={showHighlight ? 0.7 : 0}
      onBeforeCompile={striped ? applyScrewStripeShader : undefined}
      customProgramCacheKey={striped ? screwStripeCacheKey : undefined}
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
        <Steel color={fastener.color} highlighted={highlighted && !fastener.headCovered} striped={fastener.headCovered} />
      </mesh>
      <mesh position={[0, headH + shankH / 2, 0]} castShadow>
        <cylinderGeometry args={[shankR * 0.45, shankR, shankH, 12]} />
        <Steel color={fastener.color} highlighted={highlighted && !fastener.headCovered} striped={fastener.headCovered} />
      </mesh>
    </group>
  );
}

function BoltMesh({
  fastener,
  highlighted,
  offset,
}: {
  fastener: SceneFastener;
  highlighted: boolean;
  offset: Vec3;
}) {
  const quaternion = useMemo(() => lookAlongY(fastener.direction), [fastener.direction]);
  const diameter = Math.max(fastener.diameter, 0.08);
  const shankR = diameter / 2;
  const acrossFlats = diameter * 1.5;
  const headR = acrossFlats / Math.sqrt(3);
  const headH = diameter * 0.65;
  const washerR = diameter * 1.1;
  const washerH = Math.max(diameter * 0.16, 0.04);
  const nutH = diameter * 0.8;
  const span = fastener.grip && fastener.grip > 1e-4 ? fastener.grip : fastener.length;
  const shankH = Math.max(fastener.length, 0.1);
  return (
    <group position={add(fastener.origin, offset)} quaternion={quaternion}>
      <mesh position={[0, -(washerH + headH / 2), 0]} castShadow>
        <cylinderGeometry args={[headR, headR, headH, 6]} />
        <Steel color={fastener.color} highlighted={highlighted} />
      </mesh>
      <mesh position={[0, -washerH / 2, 0]} castShadow>
        <cylinderGeometry args={[washerR, washerR, washerH, 24]} />
        <Steel color={fastener.color} highlighted={highlighted} />
      </mesh>
      <mesh position={[0, shankH / 2, 0]} castShadow>
        <cylinderGeometry args={[shankR, shankR, shankH, 12]} />
        <Steel color={fastener.color} highlighted={highlighted} />
      </mesh>
      <mesh position={[0, span + washerH / 2, 0]} castShadow>
        <cylinderGeometry args={[washerR, washerR, washerH, 24]} />
        <Steel color={fastener.color} highlighted={highlighted} />
      </mesh>
      <mesh position={[0, span + washerH + nutH / 2, 0]} castShadow>
        <cylinderGeometry args={[headR, headR, nutH, 6]} />
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
  if (fastener.subtype === "bolt") {
    return <BoltMesh fastener={fastener} highlighted={highlighted} offset={offset} />;
  }
  return <ScrewMesh fastener={fastener} highlighted={highlighted} offset={offset} />;
}
