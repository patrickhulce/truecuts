"use client";

import { PivotControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { snapPosition, snapRotation, snapSteps } from "@/lib/edit";
import type { Vec3 } from "@/lib/geometry";

const AXIS_COLORS: [string, string, string] = ["#b45309", "#ca8a04", "#92400e"];

export type PartPose = {
  position: Vec3;
  rotation: Vec3;
};

function matrixFromPose(pose: PartPose): THREE.Matrix4 {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(pose.rotation[0]),
    THREE.MathUtils.degToRad(pose.rotation[1]),
    THREE.MathUtils.degToRad(pose.rotation[2]),
    "XYZ",
  );
  return new THREE.Matrix4().makeRotationFromEuler(euler).setPosition(pose.position[0], pose.position[1], pose.position[2]);
}

function poseFromMatrix(matrix: THREE.Matrix4): PartPose {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    position: [position.x, position.y, position.z],
    rotation: [
      THREE.MathUtils.radToDeg(euler.x),
      THREE.MathUtils.radToDeg(euler.y),
      THREE.MathUtils.radToDeg(euler.z),
    ],
  };
}

function snapDraft(mode: "Arrow" | "Rotator", start: PartPose, raw: PartPose, fine: boolean): PartPose {
  const steps = snapSteps(fine);
  if (mode === "Rotator") {
    return { position: start.position, rotation: snapRotation(raw.rotation, steps.deg) };
  }
  return { position: snapPosition(raw.position, steps.inch), rotation: start.rotation };
}

type PartGizmoProps = {
  pose: PartPose;
  bounds: { min: Vec3; max: Vec3 };
  onDragStart: () => void;
  onDraft: (position: Vec3, rotation: Vec3) => void;
  onCommit: (position: Vec3, rotation: Vec3) => void;
};

export function PartGizmo({ pose, bounds, onDragStart, onDraft, onCommit }: PartGizmoProps) {
  const modeRef = useRef<"Arrow" | "Rotator" | null>(null);
  const startRef = useRef(pose);
  const lastRef = useRef(pose);
  const rawRef = useRef<PartPose | null>(null);
  const fineRef = useRef(false);
  const onDraftRef = useRef(onDraft);
  const size: Vec3 = [
    Math.max(bounds.max[0] - bounds.min[0], 0.01),
    Math.max(bounds.max[1] - bounds.min[1], 0.01),
    Math.max(bounds.max[2] - bounds.min[2], 0.01),
  ];
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const pad = 0.15 * Math.max(size[0], size[1], size[2]);
  const matrix = matrixFromPose(pose);

  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);

  useEffect(() => {
    const applyFine = (fine: boolean) => {
      if (fineRef.current === fine) return;
      fineRef.current = fine;
      if (!modeRef.current || !rawRef.current) return;
      const snapped = snapDraft(modeRef.current, startRef.current, rawRef.current, fine);
      lastRef.current = snapped;
      onDraftRef.current(snapped.position, snapped.rotation);
    };
    const onKey = (event: KeyboardEvent) => {
      applyFine(event.metaKey || event.ctrlKey);
    };
    const onBlur = () => applyFine(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <PivotControls
      autoTransform={false}
      matrix={matrix}
      anchor={[1, 1, 1]}
      offset={[pad, pad, pad]}
      disableScaling
      disableSliders
      depthTest={false}
      fixed
      scale={100}
      lineWidth={6}
      axisColors={AXIS_COLORS}
      hoveredColor="#f59e0b"
      onDragStart={(info) => {
        modeRef.current = info.component === "Rotator" ? "Rotator" : "Arrow";
        startRef.current = pose;
        lastRef.current = pose;
        rawRef.current = pose;
        onDragStart();
      }}
      onDrag={(local) => {
        const next = poseFromMatrix(local);
        rawRef.current = next;
        const drafted =
          modeRef.current === "Rotator"
            ? { position: startRef.current.position, rotation: next.rotation }
            : { position: next.position, rotation: startRef.current.rotation };
        rawRef.current = drafted;
        const snapped = snapDraft(modeRef.current ?? "Arrow", startRef.current, drafted, fineRef.current);
        lastRef.current = snapped;
        onDraft(snapped.position, snapped.rotation);
      }}
      onDragEnd={() => {
        modeRef.current = null;
        rawRef.current = null;
        onCommit(lastRef.current.position, lastRef.current.rotation);
      }}
    >
      <mesh position={center} visible={false} raycast={() => null}>
        <boxGeometry args={size} />
      </mesh>
    </PivotControls>
  );
}
