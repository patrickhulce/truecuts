"use client";

import { useCursor } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { snapSteps, snapValue } from "@/lib/edit";
import { axisCoord, snapResizeFace, type Aabb, type Vec3 } from "@/lib/geometry";

const DOT_PX = 7;

type HandleSpec = {
  id: string;
  axis: 0 | 1 | 2;
  /** The face this dot pushes. "end" is the far face, "start" the near one. */
  side: "start" | "end";
  position: Vec3;
};

type Drag = {
  id: string;
  axis: 0 | 1 | 2;
  side: "start" | "end";
  coord: 0 | 1 | 2;
  base: number;
  startRaw: number;
  raw: number;
  hit: number;
  inches: number;
};

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-4;
}

/**
 * One dot at the center of each face, dragged along that face's normal so the
 * face under the cursor is the one that moves. A parameterized axis has no near
 * face to cut, so it only offers the far face.
 */
function faceHandles(
  bounds: { min: Vec3; max: Vec3 },
  cuttable: boolean,
  freeAxes: readonly (0 | 1 | 2)[],
): HandleSpec[] {
  const { min, max } = bounds;
  const mid: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const handles: HandleSpec[] = [];
  for (const axis of [0, 1, 2] as const) {
    const free = freeAxes.includes(axis);
    if (!free && !cuttable) continue;
    const coord = axisCoord(axis);
    for (const side of free ? (["end"] as const) : (["start", "end"] as const)) {
      const position: Vec3 = [mid[0], mid[1], mid[2]];
      position[coord] = side === "start" ? min[coord] : max[coord];
      handles.push({ id: `${axis}-${side}`, axis, side, position });
    }
  }
  return handles;
}

function dotScale(camera: THREE.Camera, world: THREE.Vector3, viewportHeight: number): number {
  if (viewportHeight < 1) return DOT_PX * 0.02;
  if (camera instanceof THREE.OrthographicCamera) {
    return (DOT_PX * (camera.top - camera.bottom)) / camera.zoom / viewportHeight;
  }
  const distance = Math.max(camera.position.distanceTo(world), 0.01);
  const vFov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov || 50);
  const worldHeight = 2 * Math.tan(vFov / 2) * distance;
  return (DOT_PX * worldHeight) / viewportHeight;
}

function cursorFor(coord: 0 | 1 | 2): "ew-resize" | "ns-resize" {
  return coord === 1 ? "ns-resize" : "ew-resize";
}

function ResizeDot({
  handle,
  position,
  hot,
  active,
  onPointerDown,
  onHover,
}: {
  handle: HandleSpec;
  position: Vec3;
  hot: boolean;
  active: boolean;
  onPointerDown: (handle: HandleSpec, event: { stopPropagation: () => void; nativeEvent: PointerEvent }) => void;
  onHover: (id: string | null) => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const world = useRef(new THREE.Vector3());
  const { camera, size, invalidate } = useThree();
  const coord = axisCoord(handle.axis);
  useCursor(hot || active, cursorFor(coord), "auto");
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.getWorldPosition(world.current);
    const next = dotScale(camera, world.current, size.height);
    if (Math.abs(mesh.scale.x - next) < 1e-4) return;
    mesh.scale.setScalar(next);
    invalidate();
  });
  return (
    <mesh
      ref={ref}
      position={position}
      renderOrder={8}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(handle.id);
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        onHover(null);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(handle, event);
      }}
    >
      <sphereGeometry args={[1, 18, 18]} />
      <meshStandardMaterial
        color={active || hot ? "#fff7ed" : "#f59e0b"}
        emissive={active || hot ? "#f59e0b" : "#d97706"}
        emissiveIntensity={active ? 0.95 : 0.55}
        depthTest={false}
      />
    </mesh>
  );
}

type ResizeGizmoProps = {
  bounds: { min: Vec3; max: Vec3 };
  /** Stock that takes planar cuts gets a dot on both faces of every axis. */
  cuttable?: boolean;
  /** Axes resized by a size override. They offer only the far face. */
  freeAxes?: readonly (0 | 1 | 2)[];
  fineSnap?: boolean;
  /** Member pose in the component frame. Boundary snap is measured from here. */
  position?: Vec3;
  rotation?: Vec3;
  snapTargets?: Aabb[];
  onDragStart: () => void;
  /** Return false when the length is past the stock or otherwise illegal. The drag stops. */
  onDraft: (axis: 0 | 1 | 2, side: "start" | "end", inches: number) => boolean;
  onCommit: (axis: 0 | 1 | 2, side: "start" | "end", inches: number) => void;
  onCancel: () => void;
};

export function ResizeGizmo({
  bounds,
  cuttable = false,
  freeAxes = [],
  fineSnap = false,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  snapTargets = [],
  onDragStart,
  onDraft,
  onCommit,
  onCancel,
}: ResizeGizmoProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();
  const [hovered, setHovered] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const planeRef = useRef(new THREE.Plane());
  const raycasterRef = useRef(new THREE.Raycaster());
  const ndcRef = useRef(new THREE.Vector2());
  const hitRef = useRef(new THREE.Vector3());
  const listenRef = useRef<(() => void) | null>(null);
  const fineRef = useRef(fineSnap);
  const fineSnapRef = useRef(fineSnap);
  const boundaryRef = useRef(true);
  const boundsRef = useRef(bounds);
  const positionRef = useRef(position);
  const rotationRef = useRef(rotation);
  const targetsRef = useRef(snapTargets);
  const onDraftRef = useRef(onDraft);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  const onDragStartRef = useRef(onDragStart);
  const finishRef = useRef<(commit: boolean) => void>(() => {});
  const applyInchesRef = useRef<(current: Drag) => boolean>(() => true);

  useEffect(() => {
    onDraftRef.current = onDraft;
    onCommitRef.current = onCommit;
    onCancelRef.current = onCancel;
    onDragStartRef.current = onDragStart;
    applyInchesRef.current = (current: Drag): boolean => {
      const step = snapSteps(fineRef.current).inch;
      const grid = snapValue(current.base + (current.raw - current.startRaw), step);
      const inches = snapResizeFace(
        boundsRef.current,
        positionRef.current,
        rotationRef.current,
        current.coord,
        current.side,
        grid,
        targetsRef.current,
        boundaryRef.current,
      );
      current.hit = inches;
      if (nearly(inches, current.inches)) return true;
      if (!onDraftRef.current(current.axis, current.side, inches)) return false;
      current.inches = inches;
      return true;
    };
    finishRef.current = (commit: boolean) => {
      listenRef.current?.();
      listenRef.current = null;
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current) return;
      if (commit && !nearly(current.inches, current.base)) {
        onCommitRef.current(current.axis, current.side, current.inches);
      } else onCancelRef.current();
    };
  }, [onCancel, onCommit, onDraft, onDragStart]);

  useEffect(() => {
    fineSnapRef.current = fineSnap;
    if (!dragRef.current) fineRef.current = fineSnap;
  }, [fineSnap]);

  useEffect(() => {
    if (dragRef.current) return;
    boundsRef.current = bounds;
    positionRef.current = position;
    rotationRef.current = rotation;
    targetsRef.current = snapTargets;
  }, [bounds, position, rotation, snapTargets]);

  useEffect(() => {
    const draftSnap = () => {
      const current = dragRef.current;
      if (!current) return;
      if (!applyInchesRef.current(current)) {
        finishRef.current(false);
        return;
      }
      setDrag({ ...current });
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

  useEffect(() => {
    return () => {
      listenRef.current?.();
      listenRef.current = null;
      if (!dragRef.current) return;
      dragRef.current = null;
      onCancelRef.current();
    };
  }, []);

  const axisCoordinate = (event: PointerEvent, coord: 0 | 1 | 2): number | null => {
    const group = groupRef.current;
    if (!group) return null;
    const rect = gl.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    ndcRef.current.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycasterRef.current.setFromCamera(ndcRef.current, camera);
    const hit = raycasterRef.current.ray.intersectPlane(planeRef.current, hitRef.current);
    if (!hit) return null;
    group.worldToLocal(hit);
    return hit.getComponent(coord);
  };

  const startDrag = (handle: HandleSpec, event: { stopPropagation: () => void; nativeEvent: PointerEvent }) => {
    if (event.nativeEvent.button !== 0 || dragRef.current) return;
    const group = groupRef.current;
    if (!group) return;
    event.stopPropagation();
    group.updateWorldMatrix(true, false);
    const coord = axisCoord(handle.axis);
    const plane = handle.position[coord];
    const next: Drag = {
      id: handle.id,
      axis: handle.axis,
      side: handle.side,
      coord,
      base: plane,
      startRaw: plane,
      raw: plane,
      hit: plane,
      inches: plane,
    };
    const world = new THREE.Vector3(handle.position[0], handle.position[1], handle.position[2]).applyMatrix4(
      group.matrixWorld,
    );
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    planeRef.current.setFromNormalAndCoplanarPoint(normal, world);
    const meta = event.nativeEvent.metaKey || event.nativeEvent.ctrlKey;
    fineRef.current = fineSnapRef.current || meta;
    boundaryRef.current = !(meta || event.nativeEvent.shiftKey);
    dragRef.current = next;
    setDrag(next);
    onDragStartRef.current();

    const move = (pointer: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const raw = axisCoordinate(pointer, current.coord);
      if (raw === null || !Number.isFinite(raw)) return;
      current.raw = raw;
      if (!applyInchesRef.current(current)) {
        finishRef.current(false);
        return;
      }
      setDrag({ ...current });
    };
    const up = () => finishRef.current(true);
    gl.domElement.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    listenRef.current = () => {
      gl.domElement.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  };

  const handles = faceHandles(bounds, cuttable, freeAxes);
  return (
    <group ref={groupRef}>
      {handles.map((handle) => {
        const active = drag?.id === handle.id;
        const position = handle.position;
        const shown: Vec3 = active && drag ? [position[0], position[1], position[2]] : position;
        if (active && drag) shown[drag.coord] = drag.hit;
        return (
          <ResizeDot
            key={handle.id}
            handle={handle}
            position={shown}
            hot={hovered === handle.id}
            active={active}
            onPointerDown={startDrag}
            onHover={setHovered}
          />
        );
      })}
    </group>
  );
}
