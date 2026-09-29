"use client";

import { Html, useCursor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { add, cross, normalize, scale, sub, type Vec3 } from "@/lib/geometry";
import {
  dimensionId,
  measureAlongAxes,
  type MeasureEdge,
  type MemberDimension,
  type TapeReading,
} from "@/lib/measure";
import { formatInches } from "@/lib/units";

const PICK_PX = 36;
const AXIS_NAME = ["X", "Y", "Z"] as const;

type MeasurementOverlayProps = {
  dimensions: MemberDimension[];
  corners: Vec3[];
  edges: MeasureEdge[];
  onActiveAxis: (axis: 0 | 1 | 2 | null) => void;
  onDragActive: (active: boolean) => void;
};

function ignoreRaycast() {}

function alignCylinder(direction: Vec3): THREE.Quaternion {
  const dir = new THREE.Vector3(direction[0], direction[1], direction[2]);
  if (dir.lengthSq() < 1e-12) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function perpendicular(direction: Vec3): Vec3 {
  const axis: Vec3 = Math.abs(direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const side = normalize(cross(direction, axis));
  if (side[0] === 0 && side[1] === 0 && side[2] === 0) return [1, 0, 0];
  return side;
}

function samePoint(a: Vec3 | null, b: Vec3 | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;
}

function Rod({
  a,
  b,
  radius,
  color,
  opacity = 1,
}: {
  a: Vec3;
  b: Vec3;
  radius: number;
  color: string;
  opacity?: number;
}) {
  const delta = sub(b, a);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length < 0.04) return null;
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return (
    <mesh position={mid} quaternion={alignCylinder(delta)} raycast={ignoreRaycast} renderOrder={6} frustumCulled={false}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthTest toneMapped={false} />
    </mesh>
  );
}

function CornerDot({ position }: { position: Vec3 }) {
  return (
    <mesh position={position} raycast={ignoreRaycast} renderOrder={7} frustumCulled={false}>
      <sphereGeometry args={[0.45, 16, 16]} />
      <meshBasicMaterial color="#fbbf24" depthTest={false} toneMapped={false} />
    </mesh>
  );
}

function projectPoint(
  point: Vec3,
  camera: THREE.Camera,
  width: number,
  height: number,
): { x: number; y: number; behind: boolean } {
  const world = new THREE.Vector3(point[0], point[1], point[2]);
  const behind = world.clone().applyMatrix4(camera.matrixWorldInverse).z >= -0.01;
  world.project(camera);
  return {
    x: (world.x * 0.5 + 0.5) * width,
    y: (-world.y * 0.5 + 0.5) * height,
    behind,
  };
}

export function MeasurementOverlay({
  dimensions,
  corners,
  edges,
  onActiveAxis,
  onDragActive,
}: MeasurementOverlayProps) {
  const { camera, gl } = useThree();
  const cornersRef = useRef(corners);
  const edgesRef = useRef(edges);
  const onActiveAxisRef = useRef(onActiveAxis);
  const onDragActiveRef = useRef(onDragActive);
  const dragRef = useRef<TapeReading | null>(null);
  const listenRef = useRef<(() => void) | null>(null);
  const [hover, setHover] = useState<Vec3 | null>(null);
  const [tape, setTape] = useState<TapeReading | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    cornersRef.current = corners;
    edgesRef.current = edges;
    onActiveAxisRef.current = onActiveAxis;
    onDragActiveRef.current = onDragActive;
  });

  useCursor(hover !== null || dragging, "crosshair", "auto");

  useEffect(() => {
    onActiveAxisRef.current(tape && tape.distance > 0 ? tape.axis : null);
  }, [tape]);

  useEffect(() => {
    const canvas = gl.domElement;

    const rayFrom = (event: PointerEvent): { origin: Vec3; dir: Vec3 } | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      return {
        origin: [origin.x, origin.y, origin.z],
        dir: [direction.x, direction.y, direction.z],
      };
    };

    const pickCorner = (event: PointerEvent): Vec3 | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let best: { corner: Vec3; pixel: number } | null = null;
      for (const corner of cornersRef.current) {
        const projected = projectPoint(corner, camera, rect.width, rect.height);
        if (projected.behind) continue;
        const pixel = Math.hypot(x - projected.x, y - projected.y);
        if (pixel > PICK_PX || (best && pixel >= best.pixel)) continue;
        best = { corner, pixel };
      }
      return best?.corner ?? null;
    };

    const hoverMove = (event: PointerEvent) => {
      if (dragRef.current) return;
      const next = pickCorner(event);
      setHover((current) => (samePoint(current, next) ? current : next));
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || dragRef.current) return;
      const corner = pickCorner(event);
      if (!corner) return;
      event.stopPropagation();
      event.preventDefault();
      const next: TapeReading = {
        axis: 0,
        start: corner,
        end: corner,
        distance: 0,
        snapped: false,
      };
      dragRef.current = next;
      setTape(next);
      setHover(corner);
      setDragging(true);
      onDragActiveRef.current(true);

      const move = (pointer: PointerEvent) => {
        const current = dragRef.current;
        if (!current) return;
        const live = rayFrom(pointer);
        if (!live) return;
        const reading = measureAlongAxes(current.start, live.origin, live.dir, edgesRef.current);
        if (!reading) return;
        dragRef.current = reading;
        setTape(reading);
      };
      const up = () => {
        listenRef.current?.();
        listenRef.current = null;
        dragRef.current = null;
        setDragging(false);
        onDragActiveRef.current(false);
      };
      canvas.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      listenRef.current = () => {
        canvas.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
    };

    canvas.addEventListener("pointermove", hoverMove);
    canvas.addEventListener("pointerdown", down, true);
    return () => {
      canvas.removeEventListener("pointermove", hoverMove);
      canvas.removeEventListener("pointerdown", down, true);
      listenRef.current?.();
      listenRef.current = null;
      if (dragRef.current) {
        dragRef.current = null;
        onDragActiveRef.current(false);
      }
      onActiveAxisRef.current(null);
    };
  }, [camera, gl]);

  return (
    <group>
      {dimensions.map((dimension) => {
        const id = dimensionId(dimension);
        const side = perpendicular(dimension.worldDirection);
        const tick = 1.15;
        return (
          <group key={id}>
            <Rod a={dimension.worldStart} b={dimension.worldEnd} radius={0.07} color="#a89070" opacity={0.75} />
            <Rod
              a={add(dimension.worldStart, scale(side, -tick))}
              b={add(dimension.worldStart, scale(side, tick))}
              radius={0.07}
              color="#a89070"
              opacity={0.75}
            />
            <Rod
              a={add(dimension.worldEnd, scale(side, -tick))}
              b={add(dimension.worldEnd, scale(side, tick))}
              radius={0.07}
              color="#a89070"
              opacity={0.75}
            />
            <Html
              position={dimension.badgePosition}
              center
              sprite
              pointerEvents="none"
              zIndexRange={[40, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div className="whitespace-nowrap rounded border border-[#3d2a18] bg-[#241a10]/95 px-1.5 py-0.5 font-mono text-[11px] text-[#d6c3a3] shadow-md">
                {formatInches(dimension.length)}
              </div>
            </Html>
          </group>
        );
      })}
      {hover && !samePoint(hover, tape?.start ?? null) ? <CornerDot position={hover} /> : null}
      {tape ? <TapeStrip tape={tape} /> : null}
    </group>
  );
}

function TapeStrip({ tape }: { tape: TapeReading }) {
  const delta = sub(tape.end, tape.start);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  const side = perpendicular(length > 1e-4 ? delta : [1, 0, 0]);
  const mid: Vec3 = [
    (tape.start[0] + tape.end[0]) / 2,
    (tape.start[1] + tape.end[1]) / 2,
    (tape.start[2] + tape.end[2]) / 2,
  ];
  const badge = add(tape.end, scale(side, 2.4));
  return (
    <group>
      <CornerDot position={tape.start} />
      {length >= 0.04 ? (
        <>
          <mesh position={mid} quaternion={alignCylinder(delta)} raycast={ignoreRaycast} renderOrder={8} frustumCulled={false}>
            <boxGeometry args={[0.55, length, 0.08]} />
            <meshBasicMaterial color="#fbbf24" depthTest={false} toneMapped={false} />
          </mesh>
          <CornerDot position={tape.end} />
          <Html position={badge} center sprite pointerEvents="none" zIndexRange={[50, 0]} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded border border-[#f59e0b] bg-[#241a10]/95 px-1.5 py-0.5 font-mono text-[11px] text-[#fbbf24] shadow-md">
              <div>{formatInches(tape.distance)}</div>
              <div className="text-[9px] tracking-wide text-[#f59e0b]">{AXIS_NAME[tape.axis]} AXIS</div>
            </div>
          </Html>
        </>
      ) : null}
    </group>
  );
}
