"use client";

import { Edges, useCursor } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type Vec3 } from "@/lib/geometry";
import { memberEdgeGeometry } from "@/lib/mesh/part-edges";
import { facesToGeometry, subtractBores } from "@/lib/mesh/subtract-holes";
import type { ResolvedBore } from "@/lib/schema";
import type { SceneMemberInstance } from "@/lib/scene";
import { applyStripeShader, stripeCacheKey } from "./stripeMaterial";

const HOLE_DISC_THICKNESS = 0.04;
const HOLE_DISC_LIFT = 0.02;

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

function HoleMaterial({ dimmed, muted, selected }: { dimmed: boolean; muted: boolean; selected: boolean }) {
  return (
    <meshStandardMaterial
      color="#1a120b"
      roughness={0.55}
      metalness={0.15}
      transparent
      opacity={dimmed ? 0.22 : muted ? 0.55 : 1}
      depthWrite={!dimmed && !muted}
      emissive={selected ? "#d97706" : "#000000"}
      emissiveIntensity={selected ? 0.45 : 0}
    />
  );
}

function BoreMarker({
  bore,
  dimmed,
  muted,
  selected,
}: {
  bore: ResolvedBore;
  dimmed: boolean;
  muted: boolean;
  selected: boolean;
}) {
  const mouthQuat = useMemo(() => alignCylinder(bore.normal), [bore.normal]);
  const inward: Vec3 = [-bore.normal[0], -bore.normal[1], -bore.normal[2]];
  const boreQuat = useMemo(
    () => alignCylinder([-bore.normal[0], -bore.normal[1], -bore.normal[2]]),
    [bore.normal],
  );
  const lift = HOLE_DISC_LIFT + HOLE_DISC_THICKNESS / 2;
  const radius = bore.diameter / 2;
  const mouth = shift(bore.center, bore.normal, lift);
  const boreCenter = shift(bore.center, inward, bore.depth / 2);
  const exit = shift(shift(bore.center, inward, bore.depth), inward, lift);
  return (
    <group>
      <mesh position={mouth} quaternion={mouthQuat} castShadow={!dimmed} renderOrder={dimmed ? 1 : 0}>
        <cylinderGeometry args={[radius, radius, HOLE_DISC_THICKNESS, 24]} />
        <HoleMaterial dimmed={dimmed} muted={muted} selected={selected} />
      </mesh>
      <mesh position={boreCenter} quaternion={boreQuat} castShadow={!dimmed} renderOrder={dimmed ? 1 : 0}>
        <cylinderGeometry args={[radius, radius, Math.max(bore.depth, 0.001), 24]} />
        <HoleMaterial dimmed={dimmed} muted={muted} selected={selected} />
      </mesh>
      {bore.through ? (
        <mesh position={exit} quaternion={boreQuat} castShadow={!dimmed} renderOrder={dimmed ? 1 : 0}>
          <cylinderGeometry args={[radius, radius, HOLE_DISC_THICKNESS, 24]} />
          <HoleMaterial dimmed={dimmed} muted={muted} selected={selected} />
        </mesh>
      ) : null}
    </group>
  );
}

type MemberMeshProps = {
  instance: SceneMemberInstance;
  selected: boolean;
  preview?: boolean;
  dimmed?: boolean;
  muted?: boolean;
  isolate?: boolean;
  offset?: Vec3;
  onSelect?: (key: string) => void;
};

export function MemberMesh({
  instance,
  selected,
  preview = false,
  dimmed = false,
  muted = false,
  isolate = false,
  offset = ZERO,
  onSelect,
}: MemberMeshProps) {
  const drilledBores = useMemo(
    () => [...instance.bores, ...instance.derivedBores],
    [instance.bores, instance.derivedBores],
  );
  const drilled = useMemo(() => {
    const solid = facesToGeometry(instance.faces);
    if (drilledBores.length === 0) return { geometry: solid, cut: false };
    const cut = subtractBores(solid, drilledBores);
    if (!cut) return { geometry: solid, cut: false };
    solid.dispose();
    return { geometry: cut, cut: true };
  }, [drilledBores, instance.faces]);
  const edgeGeometry = useMemo(
    () => (drilled.cut ? memberEdgeGeometry(instance.faces, drilledBores) : null),
    [drilled.cut, drilledBores, instance.faces],
  );
  const liveGeometry = useRef(drilled.geometry);
  const liveEdges = useRef(edgeGeometry);
  // eslint-disable-next-line react-hooks/refs -- dispose guard must see this render's geometry before effects
  liveGeometry.current = drilled.geometry;
  // eslint-disable-next-line react-hooks/refs -- dispose guard must see this render's geometry before effects
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
  const opacity = dimmed ? 0.22 : muted ? 0.55 : 1;
  const edgeOpacity = dimmed ? 0.18 : muted ? 0.55 : 1;
  const emissive = selected ? "#d97706" : preview ? "#c4a36a" : "#000000";
  const fastenedIntensity = selected ? 0.35 : preview ? 0.18 : 0;
  const stripeIntensity = selected ? 0.25 : preview ? 0.12 : 0;
  const edgeColor = selected ? "#f59e0b" : preview ? "#d6c3a3" : instance.fastened ? "#3b2410" : "#7f1d1d";

  return (
    <group
      position={position}
      rotation={rotation}
      onPointerOver={
        isolate
          ? undefined
          : (event) => {
              event.stopPropagation();
              setHovered(true);
            }
      }
      onPointerOut={isolate ? undefined : () => setHovered(false)}
      onClick={
        isolate
          ? undefined
          : (event) => {
              event.stopPropagation();
              onSelect?.(instance.key);
            }
      }
    >
      <mesh
        geometry={drilled.geometry}
        renderOrder={dimmed ? 1 : 0}
        castShadow={!dimmed && !muted && !isolate}
        receiveShadow={!dimmed && !muted && !isolate}
      >
      {instance.fastened ? (
        <meshStandardMaterial
          color={instance.color}
          roughness={dimmed ? 0.4 : 0.55}
          metalness={0.04}
          transparent
          opacity={opacity}
          depthWrite={!dimmed && !muted}
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
          depthWrite={!dimmed && !muted}
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
          opacity={edgeOpacity}
          depthWrite={!dimmed && !muted}
        />
      )}
    </mesh>
      {edgeGeometry ? (
        <lineSegments geometry={edgeGeometry} renderOrder={dimmed ? 1 : 0}>
          <lineBasicMaterial
            color={edgeColor}
            transparent
            opacity={edgeOpacity}
            depthWrite={!dimmed && !muted}
          />
        </lineSegments>
      ) : null}
      {drilled.cut
        ? null
        : drilledBores.map((bore, index) => (
            <BoreMarker
              key={`${instance.key}-bore-${index}`}
              bore={bore}
              dimmed={dimmed}
              muted={muted}
              selected={selected}
            />
          ))}
    </group>
  );
}
