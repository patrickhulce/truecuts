"use client";

import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import * as THREE from "three";
import { connectionContactPairs } from "@/lib/connections";
import { parseInstanceKey } from "@/lib/fasteners";
import { patchesFor, patchNeighbor, type SharedPatch, type Vec3 } from "@/lib/geometry";
import type { ResolvedBore } from "@/lib/schema";
import type { SceneConnection, SceneFastener, SceneModel, SceneMemberInstance } from "@/lib/scene";
import { formatInches } from "@/lib/units";
import { ConnectionFaceOverlay, ContactOverlay } from "./ContactOverlay";
import { FastenerMesh } from "./FastenerMesh";
import { PartGizmo, type PartPose } from "./PartGizmo";
import { MemberMesh } from "./MemberMesh";

type DraftPose = PartPose & { key: string };

type ViewportProps = {
  scene?: SceneModel;
  selectedKey: string | null;
  hoveredKey: string | null;
  onSelect: (key: string | null) => void;
  onDeleteMember?: (memberId: string) => void;
  onChangePose?: (componentId: string, placementIndex: number, position: Vec3, rotation: Vec3) => void;
  activeConnection?: SceneConnection | null;
};

const ZERO: Vec3 = [0, 0, 0];

function deg(rotation: [number, number, number]): [number, number, number] {
  return [
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
  ];
}

function quaternionInverse(rotation: Vec3): THREE.Quaternion {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    "XYZ",
  );
  return new THREE.Quaternion().setFromEuler(euler).invert();
}

function toLocalOffset(worldOffset: Vec3, qInv: THREE.Quaternion): Vec3 {
  const v = new THREE.Vector3(worldOffset[0], worldOffset[1], worldOffset[2]);
  v.applyQuaternion(qInv);
  return [v.x, v.y, v.z];
}

function averageOffset(fastener: SceneFastener, worldOffsets: Map<string, Vec3>): Vec3 {
  if (fastener.members.length === 0) return ZERO;
  const sum: Vec3 = [0, 0, 0];
  for (const member of fastener.members) {
    const offset = worldOffsets.get(member.instanceKey) ?? ZERO;
    sum[0] += offset[0];
    sum[1] += offset[1];
    sum[2] += offset[2];
  }
  const n = fastener.members.length;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

function formatBore(bore: ResolvedBore): string {
  const depth = bore.through ? "through" : `${formatInches(bore.depth)} deep`;
  return `${bore.face} at ${formatInches(bore.at[0])}, ${formatInches(bore.at[1])} · dia ${formatInches(bore.diameter)} · ${depth}`;
}

function fastenerSummary(fasteners: SceneFastener[]): string {
  if (fasteners.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const fastener of fasteners) {
    counts.set(fastener.stockLabel, (counts.get(fastener.stockLabel) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(", ");
}

function FastenerSummary({ fasteners }: { fasteners: SceneFastener[] }) {
  const covered = fasteners.filter((fastener) => fastener.headCovered);
  const clear = fasteners.filter((fastener) => !fastener.headCovered);
  if (covered.length === 0) {
    return <span className="text-[#d6c3a3]">{fastenerSummary(fasteners)}</span>;
  }
  const labels = [...new Set(covered.map((fastener) => fastener.stockLabel))].join(", ");
  return (
    <span>
      {clear.length > 0 ? <span className="text-[#d6c3a3]">{fastenerSummary(clear)} · </span> : null}
      <span className="text-rose-400">{labels} · head covered</span>
    </span>
  );
}

function SelectionCard({
  instance,
  attachedFasteners,
  patches,
  neighbors,
}: {
  instance: SceneMemberInstance;
  attachedFasteners: SceneFastener[];
  patches: SharedPatch[];
  neighbors: string[];
}) {
  const area = patches.reduce((sum, patch) => sum + patch.area, 0);
  return (
    <aside className="pointer-events-none absolute left-4 top-4 max-w-sm rounded-md border border-[#3d2a18] bg-[#241a10]/95 px-3 py-2 text-xs text-[#d6c3a3] shadow-lg">
      <div className="font-medium text-[#f59e0b]">{instance.label}</div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[#a89070]">
        <dt>id</dt>
        <dd className="text-[#d6c3a3]">{instance.memberId}</dd>
        <dt>stock</dt>
        <dd className="text-[#d6c3a3]">{instance.stockLabel}</dd>
        <dt>finished</dt>
        <dd className="text-[#d6c3a3]">
          {formatInches(instance.finished.length)} × {formatInches(instance.finished.width)} ×{" "}
          {formatInches(instance.finished.thickness)}
        </dd>
        <dt>fastened</dt>
        <dd className="text-[#d6c3a3]">{instance.fastened ? "yes" : "no"}</dd>
        <dt>fasteners</dt>
        <dd>
          <FastenerSummary fasteners={attachedFasteners} />
        </dd>
        <dt>bores</dt>
        <dd className="text-[#d6c3a3]">
          {instance.bores.length === 0 ? "none" : instance.bores.map(formatBore).join("; ")}
        </dd>
        <dt>contacts</dt>
        <dd className="text-[#d6c3a3]">
          {patches.length === 0
            ? "none"
            : `${patches.length} patch${patches.length === 1 ? "" : "es"} · ${area.toFixed(2)} in²`}
        </dd>
        {neighbors.length > 0 ? (
          <>
            <dt>neighbors</dt>
            <dd className="text-[#d6c3a3]">{neighbors.join(", ")}</dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}

export function Viewport({
  scene,
  selectedKey,
  hoveredKey,
  onSelect,
  onDeleteMember,
  onChangePose,
  activeConnection = null,
}: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [explode, setExplode] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<DraftPose | null>(null);
  const [showContacts, setShowContacts] = useState(true);
  const [focusedPatch, setFocusedPatch] = useState<string | null>(null);

  const selected = scene?.components.flatMap((component) => component.members).find((part) => part.key === selectedKey);
  const hasSelection = selectedKey !== null;
  const activeDraft = draft?.key === selectedKey ? draft : null;

  const posed = (part: SceneMemberInstance): SceneMemberInstance => {
    if (activeDraft?.key !== part.key) return part;
    return { ...part, position: activeDraft.position, rotation: activeDraft.rotation };
  };

  const gizmoPose: PartPose | undefined = selected
    ? activeDraft
      ? activeDraft
      : { position: selected.position, rotation: selected.rotation }
    : undefined;

  const selectPart = (key: string | null) => {
    setDraft(null);
    setDragging(false);
    setFocusedPatch(null);
    onSelect(key);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")) {
      return;
    }
    rootRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    if (!selected || !onDeleteMember) return;
    event.preventDefault();
    onDeleteMember(selected.memberId);
  };

  const commitDraft = (position: Vec3, rotation: Vec3) => {
    setDragging(false);
    if (selected && onChangePose) {
      const { componentId, placementIndex } = parseInstanceKey(selected.key);
      onChangePose(componentId, placementIndex, position, rotation);
    }
    setDraft(null);
  };

  const attachedFasteners = useMemo(() => {
    if (!scene || !selectedKey) return [];
    return scene.fasteners.filter((fastener) =>
      fastener.members.some((member) => member.instanceKey === selectedKey),
    );
  }, [scene, selectedKey]);

  const attachedKeys = useMemo(
    () => new Set(attachedFasteners.map((fastener) => fastener.key)),
    [attachedFasteners],
  );

  const selectedPatches = useMemo(
    () => (scene && selectedKey ? patchesFor(scene.contacts, selectedKey) : []),
    [scene, selectedKey],
  );

  const editedPatches = useMemo(() => {
    if (!scene || !selectedKey || !activeConnection) return [];
    const pairs = connectionContactPairs(activeConnection);
    return scene.contacts.patches.filter((patch) => {
      const a = patch.a.instanceKey;
      const b = patch.b.instanceKey;
      if (a !== selectedKey && b !== selectedKey) return false;
      return pairs.some(([left, right]) => (a === left && b === right) || (a === right && b === left));
    });
  }, [activeConnection, scene, selectedKey]);

  const editedPatchKeys = useMemo(() => editedPatches.map((patch) => patch.key), [editedPatches]);

  const partByKey = useMemo(() => {
    const map = new Map<string, SceneMemberInstance>();
    if (!scene) return map;
    for (const component of scene.components) {
      for (const part of component.members) map.set(part.key, part);
    }
    return map;
  }, [scene]);

  const neighborLabels = useMemo(() => {
    if (!selectedKey) return [];
    const labels = selectedPatches.map((patch) => {
      const neighbor = partByKey.get(patchNeighbor(patch, selectedKey).instanceKey);
      return neighbor?.label ?? patchNeighbor(patch, selectedKey).instanceKey;
    });
    return [...new Set(labels)];
  }, [partByKey, selectedKey, selectedPatches]);

  const worldOffsets = useMemo(() => {
    const map = new Map<string, Vec3>();
    if (!scene || explode === 0) return map;
    for (const component of scene.components) {
      for (const part of component.members) {
        map.set(part.key, [
          (part.worldCenter[0] - scene.center[0]) * explode,
          (part.worldCenter[1] - scene.center[1]) * explode,
          (part.worldCenter[2] - scene.center[2]) * explode,
        ]);
      }
    }
    return map;
  }, [scene, explode]);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="relative h-full w-full bg-[#1a120b] outline-none"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <Canvas
        shadows
        camera={{ position: [90, 55, 90], fov: 35, near: 0.1, far: 4000 }}
        onPointerMissed={() => selectPart(null)}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <color attach="background" args={["#1a120b"]} />
        <hemisphereLight args={["#ffe7c2", "#2a1a0c", 0.85]} />
        <directionalLight
          position={[80, 120, 50]}
          intensity={1.35}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-near={1}
          shadow-camera-far={400}
          shadow-camera-left={-80}
          shadow-camera-right={80}
          shadow-camera-top={80}
          shadow-camera-bottom={-80}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color="#1e140c" roughness={1} />
        </mesh>
        <Grid
          infiniteGrid
          fadeDistance={140}
          fadeStrength={0.6}
          cellSize={1}
          sectionSize={12}
          cellThickness={0.4}
          sectionThickness={1}
          cellColor="#3d2a18"
          sectionColor="#6b4a2b"
        />
        {scene?.components.map((component) => {
          const qInv = quaternionInverse(component.rotation);
          const showGizmo = Boolean(
            selected && gizmoPose && onChangePose && parseInstanceKey(selected.key).componentId === component.id,
          );
          return (
            <group key={component.id} position={component.position} rotation={deg(component.rotation)}>
              {component.members.map((part) => (
                <MemberMesh
                  key={part.key}
                  instance={posed(part)}
                  selected={part.key === selectedKey}
                  preview={part.key === hoveredKey && part.key !== selectedKey}
                  muted={part.key === selectedKey && activeConnection !== null}
                  dimmed={hasSelection && part.key !== selectedKey && part.key !== hoveredKey}
                  offset={toLocalOffset(worldOffsets.get(part.key) ?? ZERO, qInv)}
                  onSelect={selectPart}
                />
              ))}
              {showGizmo && selected && gizmoPose ? (
                <group position={toLocalOffset(worldOffsets.get(selected.key) ?? ZERO, qInv)}>
                  <PartGizmo
                    key={`${selected.key}-${selected.position.join(",")}-${selected.rotation.join(",")}`}
                    pose={gizmoPose}
                    bounds={selected.bounds}
                    onDragStart={() => setDragging(true)}
                    onDraft={(position, rotation) => setDraft({ key: selected.key, position, rotation })}
                    onCommit={commitDraft}
                  />
                </group>
              ) : null}
            </group>
          );
        })}
        {scene?.fasteners.map((fastener) => (
          <FastenerMesh
            key={fastener.key}
            fastener={fastener}
            highlighted={attachedKeys.has(fastener.key)}
            offset={averageOffset(fastener, worldOffsets)}
          />
        ))}
        {scene && selectedKey && editedPatches.length > 0 ? (
          <ConnectionFaceOverlay
            patches={editedPatches}
            instanceKey={selectedKey}
            explodeOffset={worldOffsets.get(selectedKey) ?? ZERO}
          />
        ) : null}
        {scene && showContacts && selectedKey ? (
          <ContactOverlay
            contacts={scene.contacts}
            instanceKey={selectedKey}
            explodeOffset={worldOffsets.get(selectedKey) ?? ZERO}
            focusedKey={focusedPatch}
            onFocus={setFocusedPatch}
            omitKeys={editedPatchKeys}
          />
        ) : null}
        <OrbitControls
          makeDefault
          enabled={!dragging}
          target={[20, 16, 12]}
          maxPolarAngle={Math.PI / 2 + (20 * Math.PI) / 180}
        />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#b45309", "#ca8a04", "#92400e"]} labelColor="#d6c3a3" />
        </GizmoHelper>
      </Canvas>
      {selected ? (
        <SelectionCard instance={selected} attachedFasteners={attachedFasteners} patches={selectedPatches} neighbors={neighborLabels} />
      ) : null}
      {scene ? (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md border border-[#3d2a18] bg-[#241a10]/95 px-3 py-2 text-xs text-[#d6c3a3] shadow-lg">
          <label htmlFor="explode" className="text-[#a89070]">
            Explode
          </label>
          <input
            id="explode"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={explode}
            onChange={(event) => setExplode(Number(event.target.value))}
            className="h-1 w-40 cursor-pointer accent-[#f59e0b]"
          />
          <span className="w-8 tabular-nums text-[#a89070]">{Math.round(explode * 100)}%</span>
          <label htmlFor="contacts" className="ml-2 flex cursor-pointer items-center gap-1.5 text-[#a89070]">
            <input
              id="contacts"
              type="checkbox"
              checked={showContacts}
              onChange={(event) => setShowContacts(event.target.checked)}
              className="accent-[#f59e0b]"
            />
            Contacts
          </label>
        </div>
      ) : null}
      {!scene ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#a89070]">
          Fix the YAML to see the build.
        </div>
      ) : null}
    </div>
  );
}
