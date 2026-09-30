"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Polyhedron, Vec3 } from "@/lib/geometry";
import { facesToGeometry } from "@/lib/mesh/subtract-holes";
import { fastenerQuaternion, fastenerSolid, type FastenerPiece } from "@/lib/mesh/fastener-solids";
import type { SceneFastener } from "@/lib/scene";
import { applyScrewStripeShader, screwStripeCacheKey } from "./stripeMaterial";

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

function FacePiece({
  faces,
  position,
  color,
  highlighted,
}: {
  faces: Polyhedron;
  position: Vec3;
  color: string;
  highlighted: boolean;
}) {
  const geometry = useMemo(() => facesToGeometry(faces), [faces]);
  const live = useRef(geometry);
  // eslint-disable-next-line react-hooks/refs -- dispose guard must see this render's geometry before effects
  live.current = geometry;
  useEffect(() => {
    const current = geometry;
    return () => {
      queueMicrotask(() => {
        if (live.current !== current) current.dispose();
      });
    };
  }, [geometry]);
  return (
    <mesh geometry={geometry} position={position}>
      <Steel color={color} highlighted={highlighted} />
    </mesh>
  );
}

function SolidPieces({
  pieces,
  color,
  highlighted,
  striped,
}: {
  pieces: FastenerPiece[];
  color: string;
  highlighted: boolean;
  striped: boolean;
}) {
  return pieces.map((piece, index) =>
    piece.kind === "cylinder" ? (
      <mesh key={index} position={piece.position}>
        <cylinderGeometry args={[piece.radiusTop, piece.radiusBottom, piece.height, piece.segments]} />
        <Steel color={color} highlighted={highlighted} striped={striped} />
      </mesh>
    ) : (
      <FacePiece
        key={index}
        faces={piece.faces}
        position={piece.position}
        color={color}
        highlighted={highlighted}
      />
    ),
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
            quaternion={fastenerQuaternion(dir)}
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
  const solid = useMemo(() => fastenerSolid(fastener), [fastener]);
  const quaternion = useMemo(
    () => (solid ? fastenerQuaternion(solid.direction, solid.across) : new THREE.Quaternion()),
    [solid],
  );
  if (fastener.subtype === "glue") {
    return <GlueMesh fastener={fastener} highlighted={highlighted} offset={offset} />;
  }
  if (!solid) return null;
  const striped =
    Boolean(fastener.headCovered) && (fastener.subtype === "screw" || fastener.subtype === "nail");
  return (
    <group position={add(fastener.origin, offset)} quaternion={quaternion}>
      <SolidPieces pieces={solid.pieces} color={fastener.color} highlighted={highlighted} striped={striped} />
    </group>
  );
}
