"use client";

import { PivotControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { chooseGizmoPlacement } from "@/lib/gizmo-placement";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { snapRotation, snapSteps, snapValue } from "@/lib/edit";
import { positionAlongAxis, type Aabb, type Vec3 } from "@/lib/geometry";

import { DIAGONAL_DIRECTIONS, GIZMO_HANDLE, snapDiagonalPosition } from "@/lib/gizmo-interaction";

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

function draggedAxis(start: Vec3, raw: Vec3): 0 | 1 | 2 | null {
  let axis: 0 | 1 | 2 | null = null;
  let best = 1e-4;
  for (let index = 0; index < 3; index++) {
    const delta = Math.abs(raw[index] - start[index]);
    if (delta > best) {
      best = delta;
      axis = index as 0 | 1 | 2;
    }
  }
  return axis;
}

function snapDraft(
  mode: "Arrow" | "Rotator",
  start: PartPose,
  raw: PartPose,
  fine: boolean,
  bounds: Aabb,
  targets: Aabb[],
  boundary: boolean,
  axis: 0 | 1 | 2 | null,
  diagonal: Vec3 | null,
): PartPose {
  const steps = snapSteps(fine);
  if (mode === "Rotator") {
    return { position: start.position, rotation: snapRotation(raw.rotation, steps.deg) };
  }
  if (diagonal) return { position: snapDiagonalPosition(start.position, raw.position, diagonal, steps.inch), rotation: start.rotation };
  if (axis === null) return { position: start.position, rotation: start.rotation };
  return {
    position: positionAlongAxis(
      start.position,
      axis,
      snapValue(raw.position[axis], steps.inch),
      bounds,
      start.rotation,
      targets,
      boundary,
    ),
    rotation: start.rotation,
  };
}

type PartGizmoProps = {
  pose: PartPose;
  bounds: { min: Vec3; max: Vec3 };
  snapTargets?: Aabb[];
  fineSnap?: boolean;
  disableRotations?: boolean;
  onDragStart: () => void;
  onDraft: (position: Vec3, rotation: Vec3) => void;
  onCommit: (position: Vec3, rotation: Vec3) => void;
};

export function PartGizmo({
  pose,
  bounds,
  snapTargets = [],
  fineSnap = false,
  disableRotations = false,
  onDragStart,
  onDraft,
  onCommit,
}: PartGizmoProps) {
  const modeRef = useRef<"Arrow" | "Rotator" | null>(null);
  const diagonalRef = useRef<Vec3 | null>(null);
  const axisRef = useRef<0 | 1 | 2 | null>(null);
  const startRef = useRef(pose);
  const lastRef = useRef(pose);
  const rawRef = useRef<PartPose | null>(null);
  const fineRef = useRef(fineSnap);
  const fineSnapRef = useRef(fineSnap);
  const boundaryRef = useRef(true);
  const boundsRef = useRef(bounds);
  const targetsRef = useRef(snapTargets);
  const onDraftRef = useRef(onDraft);
  const pivotRef = useRef<THREE.Group>(null);
  const [anchor, setAnchor] = useState<Vec3 | null>(null);
  const anchorRef = useRef<Vec3 | undefined>(undefined);
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
  const matrix = matrixFromPose(pose);
  // Counterrotate only the controls; retain the item's pose and local bounds.
  // ResizeGizmo has its own item-aligned frame and does not use this transform.
  const controlRotation = new THREE.Euler().setFromRotationMatrix(matrix.clone().invert(), "XYZ");

  useFrame(({ camera, size }) => {
    if (modeRef.current || !pivotRef.current?.parent) return;
    pivotRef.current.parent.updateWorldMatrix(true, false);
    const world = pivotRef.current.parent.matrixWorld.clone().multiply(matrix);
    const next = chooseGizmoPlacement(bounds, world, camera, size.width, size.height, anchorRef.current);
    const previous = anchorRef.current;
    if (next && previous && next.every((value, axis) => Math.abs(value - previous[axis]) < 1e-5)) return;
    if (!next && !previous) return;
    anchorRef.current = next ?? undefined;
    setAnchor(next);
  });

  useEffect(() => {
    boundsRef.current = bounds;
    targetsRef.current = snapTargets;
  }, [bounds, snapTargets]);

  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);

  useEffect(() => {
    fineSnapRef.current = fineSnap;
    if (!modeRef.current) fineRef.current = fineSnap;
  }, [fineSnap]);

  useEffect(() => {
    const draftSnap = () => {
      if (!modeRef.current || !rawRef.current) return;
      const snapped = snapDraft(
        modeRef.current,
        startRef.current,
        rawRef.current,
        fineRef.current,
        boundsRef.current,
        targetsRef.current,
        boundaryRef.current,
        axisRef.current,
        diagonalRef.current,
      );
      lastRef.current = snapped;
      onDraftRef.current(snapped.position, snapped.rotation);
    };
    const applyModifiers = (held: { meta: boolean; shift: boolean } | null) => {
      const meta = held?.meta ?? false;
      const shift = held?.shift ?? false;
      const fine = meta || fineSnapRef.current;
      const boundary = !(meta || shift);
      if (fineRef.current === fine && boundaryRef.current === boundary) return;
      fineRef.current = fine;
      boundaryRef.current = boundary;
      draftSnap();
    };
    const onKey = (event: KeyboardEvent) => {
      applyModifiers({ meta: event.metaKey || event.ctrlKey, shift: event.shiftKey });
    };
    const onBlur = () => applyModifiers(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const handleDrag = (local: THREE.Matrix4) => {
    const next = poseFromMatrix(local);
    rawRef.current = next;
    const drafted =
      modeRef.current === "Rotator"
        ? { position: startRef.current.position, rotation: next.rotation }
        : { position: next.position, rotation: startRef.current.rotation };
    rawRef.current = drafted;
    if (modeRef.current !== "Rotator" && axisRef.current === null && !diagonalRef.current) {
      axisRef.current = draggedAxis(startRef.current.position, next.position);
    }
    const snapped = snapDraft(
      modeRef.current ?? "Arrow",
      startRef.current,
      drafted,
      fineRef.current,
      boundsRef.current,
      targetsRef.current,
      boundaryRef.current,
      axisRef.current,
      diagonalRef.current,
    );
    lastRef.current = snapped;
    onDraft(snapped.position, snapped.rotation);
  };
  const handleDragEnd = () => {
    modeRef.current = null;
    axisRef.current = null;
    diagonalRef.current = null;
    rawRef.current = null;
    onCommit(lastRef.current.position, lastRef.current.rotation);
  };

  return (
    <>
      {DIAGONAL_DIRECTIONS.map((direction, index) => {
        const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...direction).normalize());
        const rotation = new THREE.Euler().setFromRotationMatrix(matrix.clone().invert().multiply(new THREE.Matrix4().makeRotationFromQuaternion(turn)), "XYZ");
        return <PivotControls
          key={index}
          autoTransform={false} matrix={matrix}
          rotation={[rotation.x, rotation.y, rotation.z]}
          offset={anchor ?? center} visible={anchor !== null}
          activeAxes={[true, false, false]}
          disableRotations disableScaling disableSliders
          depthTest={false} fixed scale={76} lineWidth={4}
          axisColors={["#80653a", "#80653a", "#80653a"]} opacity={0.7}
          hoveredColor="#f59e0b" userData={GIZMO_HANDLE}
          onDragStart={() => {
            modeRef.current = "Arrow";
            diagonalRef.current = direction;
            axisRef.current = null;
            startRef.current = pose;
            lastRef.current = pose;
            rawRef.current = pose;
            onDragStart();
          }}
          onDrag={handleDrag} onDragEnd={handleDragEnd}
        />;
      })}
    <PivotControls
      userData={GIZMO_HANDLE}
      ref={pivotRef}
      autoTransform={false}
      matrix={matrix}
      rotation={[controlRotation.x, controlRotation.y, controlRotation.z]}
      offset={anchor ?? center}
      visible={anchor !== null}
      disableScaling
      disableSliders
      disableRotations={disableRotations}
      depthTest={false}
      fixed
      scale={100}
      lineWidth={6}
      axisColors={AXIS_COLORS}
      hoveredColor="#f59e0b"
      onDragStart={(info) => {
        diagonalRef.current = null;
        modeRef.current = info.component === "Rotator" ? "Rotator" : "Arrow";
        axisRef.current =
          info.component === "Arrow" ? info.axis : null;
        startRef.current = pose;
        lastRef.current = pose;
        rawRef.current = pose;
        onDragStart();
      }}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
    >
      <mesh position={center} visible={false} raycast={() => null}>
        <boxGeometry args={size} />
      </mesh>
    </PivotControls>
    </>
  );
}
