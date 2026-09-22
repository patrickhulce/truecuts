"use client";

import { Edges, useCursor } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type Vec3 } from "@/lib/geometry";
import { partEdgeGeometry } from "@/lib/mesh/part-edges";
import { facesToGeometry, subtractHoles } from "@/lib/mesh/subtract-holes";
import type { ResolvedHole } from "@/lib/schema";
import type { ScenePartInstance } from "@/lib/scene";

const HOLE_DISC_THICKNESS = 0.04;
const HOLE_DISC_LIFT = 0.02;

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

const ZERO: Vec3 = [0, 0, 0];

function alignCylinder(direction: Vec3): THREE.Quaternion {
  const dir = new THREE.Vector3(direction[0], direction[1], direction[2]);
  if (dir.lengthSq() < 1e-10) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function shift(point: Vec3, direction: Vec3, distance: number): Vec3 {
  return [
    point[0] + direction[0] * distance,
    point[1] + direction[1] * distance,
    point[2] + direction[2] * distance,
  ];
}

function HoleMaterial({ dimmed, selected }: { dimmed: boolean; selected: boolean }) {
  return (
    <meshStandardMaterial
      color="#1a120b"
      roughness={0.55}
      metalness={0.15}
      transparent
      opacity={dimmed ? 0.22 : 1}
      depthWrite={!dimmed}
      emissive={selected ? "#d97706" : "#000000"}
      emissiveIntensity={selected ? 0.45 : 0}
    />
  );
}

function HoleMarker({ hole, dimmed, selected }: { hole: ResolvedHole; dimmed: boolean; selected: boolean }) {
  const mouthQuat = useMemo(() => alignCylinder(hole.normal), [hole.normal]);
  const inward: Vec3 = [-hole.normal[0], -hole.normal[1], -hole.normal[2]];
  const boreQuat = useMemo(() => alignCylinder(inward), [hole.normal]);
  const lift = HOLE_DISC_LIFT + HOLE_DISC_THICKNESS / 2;
  const radius = hole.diameter / 2;
  const mouth = shift(hole.center, hole.normal, lift);
  const bore = shift(hole.center, inward, hole.depth / 2);
  const exit = shift(shift(hole.center, inward, hole.depth), inward, lift);
  return (
    <group>
      <mesh position={mouth} quaternion={mouthQuat} castShadow={!dimmed} renderOrder={dimmed ? 1 : 0}>
        <cylinderGeometry args={[radius, radius, HOLE_DISC_THICKNESS, 24]} />
        <HoleMaterial dimmed={dimmed} selected={selected} />
      </mesh>
      <mesh position={bore} quaternion={boreQuat} castShadow={!dimmed} renderOrder={dimmed ? 1 : 0}>
        <cylinderGeometry args={[radius, radius, Math.max(hole.depth, 0.001), 24]} />
        <HoleMaterial dimmed={dimmed} selected={selected} />
      </mesh>
      {hole.through ? (
        <mesh position={exit} quaternion={boreQuat} castShadow={!dimmed} renderOrder={dimmed ? 1 : 0}>
          <cylinderGeometry args={[radius, radius, HOLE_DISC_THICKNESS, 24]} />
          <HoleMaterial dimmed={dimmed} selected={selected} />
        </mesh>
      ) : null}
    </group>
  );
}

type PartMeshProps = {
  instance: ScenePartInstance;
  selected: boolean;
  preview?: boolean;
  dimmed?: boolean;
  offset?: Vec3;
  onSelect: (key: string) => void;
};

export function PartMesh({
  instance,
  selected,
  preview = false,
  dimmed = false,
  offset = ZERO,
  onSelect,
}: PartMeshProps) {
  const drilled = useMemo(() => {
    const solid = facesToGeometry(instance.faces);
    if (instance.holes.length === 0) return { geometry: solid, cut: false };
    const cut = subtractHoles(solid, instance.holes);
    if (!cut) return { geometry: solid, cut: false };
    solid.dispose();
    return { geometry: cut, cut: true };
  }, [instance.faces, instance.holes]);
  const edgeGeometry = useMemo(
    () => (drilled.cut ? partEdgeGeometry(instance.faces, instance.holes) : null),
    [drilled.cut, instance.faces, instance.holes],
  );
  const liveGeometry = useRef(drilled.geometry);
  const liveEdges = useRef(edgeGeometry);
  liveGeometry.current = drilled.geometry;
  liveEdges.current = edgeGeometry;
  useEffect(() => {
    const geometry = drilled.geometry;
    return () => {
      // Defer so React Strict Mode's simulated unmount does not dispose the mesh still on screen.
      queueMicrotask(() => {
        if (liveGeometry.current !== geometry) geometry.dispose();
      });
    };
  }, [drilled]);
  useEffect(() => {
    const geometry = edgeGeometry;
    return () => {
      if (!geometry) return;
      queueMicrotask(() => {
        if (liveEdges.current !== geometry) geometry.dispose();
      });
    };
  }, [edgeGeometry]);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const rotation: [number, number, number] = [
    THREE.MathUtils.degToRad(instance.rotation[0]),
    THREE.MathUtils.degToRad(instance.rotation[1]),
    THREE.MathUtils.degToRad(instance.rotation[2]),
  ];
  const position: Vec3 = [
    instance.position[0] + offset[0],
    instance.position[1] + offset[1],
    instance.position[2] + offset[2],
  ];
  // Keep `transparent` always on. Three.js compiles `#define OPAQUE` into the
  // shader when transparent is false; R3F does not set `needsUpdate` when that
  // flag later flips, so opacity would otherwise be ignored and parts stay solid.
  const opacity = dimmed ? 0.22 : 1;
  const emissive = selected ? "#d97706" : preview ? "#c4a36a" : "#000000";
  const fastenedIntensity = selected ? 0.35 : preview ? 0.18 : 0;
  const stripeIntensity = selected ? 0.25 : preview ? 0.12 : 0;
  const edgeColor = selected ? "#f59e0b" : preview ? "#d6c3a3" : instance.fastened ? "#3b2410" : "#7f1d1d";

  return (
    <group
      position={position}
      rotation={rotation}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(instance.key);
      }}
    >
      <mesh geometry={drilled.geometry} renderOrder={dimmed ? 1 : 0} castShadow={!dimmed} receiveShadow={!dimmed}>
      {instance.fastened ? (
        <meshStandardMaterial
          color={instance.color}
          roughness={dimmed ? 0.4 : 0.55}
          metalness={0.04}
          transparent
          opacity={opacity}
          depthWrite={!dimmed}
          emissive={emissive}
          emissiveIntensity={fastenedIntensity}
        />
      ) : (
        <meshStandardMaterial
          key="stripes"
          color="#ffffff"
          roughness={dimmed ? 0.35 : 0.45}
          metalness={0.04}
          transparent
          opacity={opacity}
          depthWrite={!dimmed}
          emissive={emissive}
          emissiveIntensity={stripeIntensity}
          onBeforeCompile={applyStripeShader}
          customProgramCacheKey={stripeCacheKey}
        />
      )}
      {drilled.cut ? null : (
        <Edges
          threshold={20}
          color={edgeColor}
          transparent
          opacity={dimmed ? 0.18 : 1}
          depthWrite={!dimmed}
        />
      )}
    </mesh>
      {edgeGeometry ? (
        <lineSegments geometry={edgeGeometry} renderOrder={dimmed ? 1 : 0}>
          <lineBasicMaterial
            color={edgeColor}
            transparent
            opacity={dimmed ? 0.18 : 1}
            depthWrite={!dimmed}
          />
        </lineSegments>
      ) : null}
      {drilled.cut
        ? null
        : instance.holes.map((hole, index) => (
            <HoleMarker key={`${instance.key}-hole-${index}`} hole={hole} dimmed={dimmed} selected={selected} />
          ))}
    </group>
  );
}
