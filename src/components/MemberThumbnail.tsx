"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import * as THREE from "three";
import type { SceneMemberInstance } from "@/lib/scene";
import { MemberMesh } from "./MemberMesh";

function Fit({ instance }: { instance: SceneMemberInstance }) {
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  const { min, max } = instance.bounds;

  useLayoutEffect(() => {
    const camera = get().camera;
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    if (size.width < 1 || size.height < 1) return;
    const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.5);
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    camera.position.set(center.x + extent, center.y + extent * 0.85, center.z + extent);
    camera.lookAt(center);
    camera.near = 0.01;
    camera.far = extent * 20;
    camera.zoom = (Math.min(size.width, size.height) * 0.72) / extent;
    camera.updateProjectionMatrix();
    get().invalidate();
  }, [get, max, min, size.height, size.width]);

  return null;
}

export function MemberThumbnail({ instance }: { instance: SceneMemberInstance }) {
  const isolated: SceneMemberInstance = {
    ...instance,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  return (
    <div className="pointer-events-none h-16 w-16 shrink-0 overflow-hidden rounded border border-[#3d2a18] bg-[#140e09]">
      <Canvas
        orthographic
        frameloop="demand"
        dpr={1}
        gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
        camera={{ position: [1, 1, 1], zoom: 8, near: 0.01, far: 1000 }}
      >
        <color attach="background" args={["#140e09"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 6, 3]} intensity={1.15} />
        <MemberMesh instance={isolated} selected={false} isolate />
        <Fit instance={isolated} />
      </Canvas>
    </div>
  );
}
