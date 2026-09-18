"use client";

import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { formatInches } from "@/lib/units";
import type { SceneModel, ScenePartInstance } from "@/lib/scene";
import { PartMesh } from "./PartMesh";

type ViewportProps = {
  scene?: SceneModel;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
};

function deg(rotation: [number, number, number]): [number, number, number] {
  return [
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
  ];
}

function SelectionCard({ instance }: { instance: ScenePartInstance }) {
  return (
    <aside className="pointer-events-none absolute left-4 top-4 max-w-sm rounded-md border border-[#3d2a18] bg-[#241a10]/95 px-3 py-2 text-xs text-[#d6c3a3] shadow-lg">
      <div className="font-medium text-[#f59e0b]">{instance.label}</div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[#a89070]">
        <dt>id</dt>
        <dd className="text-[#d6c3a3]">{instance.partId}</dd>
        <dt>stock</dt>
        <dd className="text-[#d6c3a3]">{instance.stockLabel}</dd>
        <dt>finished</dt>
        <dd className="text-[#d6c3a3]">
          {formatInches(instance.finished.length)} × {formatInches(instance.finished.width)} ×{" "}
          {formatInches(instance.finished.thickness)}
        </dd>
      </dl>
    </aside>
  );
}

export function Viewport({ scene, selectedKey, onSelect }: ViewportProps) {
  const selected = scene?.components.flatMap((component) => component.parts).find((part) => part.key === selectedKey);

  return (
    <div className="relative h-full w-full bg-[#1a120b]">
      <Canvas
        shadows
        camera={{ position: [90, 55, 90], fov: 35, near: 0.1, far: 4000 }}
        onPointerMissed={() => onSelect(null)}
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
        {scene?.components.map((component) => (
          <group key={component.id} position={component.position} rotation={deg(component.rotation)}>
            {component.parts.map((part) => (
              <PartMesh
                key={part.key}
                instance={part}
                selected={part.key === selectedKey}
                onSelect={onSelect}
              />
            ))}
          </group>
        ))}
        <OrbitControls makeDefault target={[20, 16, 12]} maxPolarAngle={Math.PI / 2.05} />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#b45309", "#ca8a04", "#92400e"]} labelColor="#d6c3a3" />
        </GizmoHelper>
      </Canvas>
      {selected ? <SelectionCard instance={selected} /> : null}
      {!scene ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#a89070]">
          Fix the YAML to see the build.
        </div>
      ) : null}
    </div>
  );
}
