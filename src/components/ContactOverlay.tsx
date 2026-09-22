"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  faceNormal,
  hostForPatch,
  offsetFace,
  patchesFor,
  patchNormalFor,
  type Face,
  type SceneContacts,
  type SharedPatch,
  type Vec3,
} from "@/lib/geometry";

const LIFT = 0.02;
const ZERO: Vec3 = [0, 0, 0];

function fanGeometry(face: Face): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  if (face.length >= 3) {
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

function loopGeometry(face: Face): THREE.BufferGeometry {
  const positions = new Float32Array(face.length * 3);
  face.forEach((p, i) => {
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function shift(face: Face, offset: Vec3): Face {
  return face.map((p) => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
}

function liftedFace(patch: SharedPatch, instanceKey: string, explodeOffset: Vec3): Face {
  const n = patchNormalFor(patch, instanceKey);
  return shift(offsetFace(patch.polygon, n, LIFT), explodeOffset);
}

type ContactOverlayProps = {
  contacts: SceneContacts;
  instanceKey: string;
  explodeOffset?: Vec3;
  focusedKey: string | null;
  onFocus: (key: string | null) => void;
  omitKeys?: string[];
};

export function ContactOverlay({
  contacts,
  instanceKey,
  explodeOffset = ZERO,
  focusedKey,
  onFocus,
  omitKeys = [],
}: ContactOverlayProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const patches = useMemo(
    () => patchesFor(contacts, instanceKey).filter((patch) => !omitKeys.includes(patch.key)),
    [contacts, instanceKey, omitKeys],
  );

  const meshes = useMemo(
    () =>
      patches.map((patch) => ({
        key: patch.key,
        geometry: fanGeometry(liftedFace(patch, instanceKey, explodeOffset)),
      })),
    [explodeOffset, instanceKey, patches],
  );

  const focused = focusedKey ? patches.find((patch) => patch.key === focusedKey) : undefined;
  const host = focused ? hostForPatch(contacts, focused, instanceKey) : undefined;

  const hostGeometry = useMemo(() => {
    if (!host || !focused) return null;
    const n = patchNormalFor(focused, instanceKey);
    return loopGeometry(shift(offsetFace(host.polygon, n, LIFT), explodeOffset));
  }, [explodeOffset, focused, host, instanceKey]);

  useEffect(() => {
    return () => {
      for (const mesh of meshes) mesh.geometry.dispose();
    };
  }, [meshes]);

  useEffect(() => {
    return () => {
      hostGeometry?.dispose();
    };
  }, [hostGeometry]);

  return (
    <group>
      {meshes.map((mesh) => {
        const isolated = focusedKey !== null;
        const active = !isolated || mesh.key === focusedKey;
        const hovered = mesh.key === hoveredKey;
        const focusedMesh = mesh.key === focusedKey;
        return (
          <mesh
            key={mesh.key}
            geometry={mesh.geometry}
            renderOrder={4}
            onPointerOver={(event) => {
              event.stopPropagation();
              setHoveredKey(mesh.key);
            }}
            onPointerOut={() => setHoveredKey((current) => (current === mesh.key ? null : current))}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onFocus(mesh.key === focusedKey ? null : mesh.key);
            }}
          >
            <meshStandardMaterial
              color={focusedMesh ? "#22d3ee" : "#2dd4bf"}
              emissive={focusedMesh || hovered ? "#22d3ee" : "#0f766e"}
              emissiveIntensity={focusedMesh ? 0.55 : hovered ? 0.4 : 0.25}
              transparent
              opacity={active ? 0.72 : 0.16}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
      {hostGeometry ? (
        <lineLoop geometry={hostGeometry} renderOrder={5}>
          <lineBasicMaterial color="#38bdf8" />
        </lineLoop>
      ) : null}
    </group>
  );
}

export function ConnectionFaceOverlay({
  patches,
  instanceKey,
  explodeOffset = ZERO,
}: {
  patches: SharedPatch[];
  instanceKey: string;
  explodeOffset?: Vec3;
}) {
  const meshes = useMemo(
    () =>
      patches.map((patch) => ({
        key: patch.key,
        geometry: fanGeometry(liftedFace(patch, instanceKey, explodeOffset)),
      })),
    [explodeOffset, instanceKey, patches],
  );

  useEffect(() => {
    return () => {
      for (const mesh of meshes) mesh.geometry.dispose();
    };
  }, [meshes]);

  return (
    <group>
      {meshes.map((mesh) => (
        <mesh key={mesh.key} geometry={mesh.geometry} renderOrder={6}>
          <meshStandardMaterial
            color="#a855f7"
            emissive="#a855f7"
            emissiveIntensity={0.45}
            transparent
            opacity={0.85}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
