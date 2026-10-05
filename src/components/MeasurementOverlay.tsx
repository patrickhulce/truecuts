"use client";

import { Html, Line, useCursor } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { add, cross, len, normalize, scale, sub, type Vec3 } from "@/lib/geometry";
import { measureAlongAxes, type MeasureEdge, type TapeReading } from "@/lib/measure";
import { tapeBadgePlacement, type ScreenPoint } from "@/lib/tape-badge";
import { formatInches } from "@/lib/units";

const PICK_PX = 36;
const AXIS_NAME = ["X", "Y", "Z"] as const;
const NEON = "#39ff14";
/** Screen thickness of the measured segment, in CSS pixels. */
const LINE_PX = 4;
const LINE_GLOW_PX = 16;
/** End bars: long enough to read as brackets, thick enough to beat the segment. */
const TICK_LENGTH_PX = 20;
const TICK_PX = 4;
const TICK_GLOW_PX = 16;
/** Keeps the readout past the end bar. Half the bar, plus a gap. */
const BADGE_GAP_PX = TICK_LENGTH_PX / 2 + 28;

type MeasurementOverlayProps = {
  corners: Vec3[];
  edges: MeasureEdge[];
  onActiveAxis: (axis: 0 | 1 | 2 | null) => void;
  onDragActive: (active: boolean) => void;
};

function ignoreRaycast() {}

function samePoint(a: Vec3 | null, b: Vec3 | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;
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
  const [pointer, setPointer] = useState<ScreenPoint | null>(null);
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

    const canvasPoint = (event: PointerEvent): ScreenPoint | null => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

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
      const point = canvasPoint(event);
      if (point) setPointer(point);
      onDragActiveRef.current(true);

      const move = (pointerEvent: PointerEvent) => {
        const current = dragRef.current;
        if (!current) return;
        const point = canvasPoint(pointerEvent);
        if (point) setPointer(point);
        const live = rayFrom(pointerEvent);
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
      {hover && !samePoint(hover, tape?.start ?? null) ? <CornerDot position={hover} /> : null}
      {tape ? <TapeStrip tape={tape} pointer={pointer} /> : null}
    </group>
  );
}

function TapeStrip({ tape, pointer }: { tape: TapeReading; pointer: ScreenPoint | null }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const badgeRef = useRef<HTMLDivElement>(null);
  const delta = sub(tape.end, tape.start);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  const startPx = projectPoint(tape.start, camera, size.width, size.height);
  const endPx = projectPoint(tape.end, camera, size.width, size.height);
  const placement = tapeBadgePlacement(startPx, endPx, pointer, BADGE_GAP_PX);
  const segment: [Vec3, Vec3] = [tape.start, tape.end];
  const startTick = length >= 0.04 ? tickPoints(tape.start, delta, camera, size.height) : null;
  const endTick = length >= 0.04 ? tickPoints(tape.end, delta, camera, size.height) : null;

  const calculatePosition = (el: THREE.Object3D, cam: THREE.Camera, viewport: { width: number; height: number }) => {
    const end = projectObject(el, cam, viewport);
    const start = projectPoint(tape.start, cam, viewport.width, viewport.height);
    const next = tapeBadgePlacement(start, end, pointer, BADGE_GAP_PX);
    if (badgeRef.current) badgeRef.current.style.transform = next.transform;
    return [end.x, end.y];
  };

  return (
    <group>
      {length >= 0.04 && startTick && endTick ? (
        <>
          <TapeMark points={segment} width={LINE_GLOW_PX} opacity={0.35} />
          <TapeMark points={segment} width={LINE_PX} />
          <TapeMark points={startTick} width={TICK_GLOW_PX} opacity={0.4} />
          <TapeMark points={startTick} width={TICK_PX} />
          <TapeMark points={endTick} width={TICK_GLOW_PX} opacity={0.4} />
          <TapeMark points={endTick} width={TICK_PX} />
          <Html
            position={tape.end}
            calculatePosition={calculatePosition}
            sprite
            pointerEvents="none"
            zIndexRange={[50, 0]}
            style={{ pointerEvents: "none" }}
          >
            <div
              ref={badgeRef}
              className="whitespace-nowrap rounded border border-[#39ff14] bg-[#241a10]/95 px-2 py-1 font-mono text-sm text-[#39ff14] shadow-md"
              style={{ transform: placement.transform }}
            >
              <div>{formatInches(tape.distance)}</div>
              <div className="text-[10px] tracking-wide text-[#86efac]">{AXIS_NAME[tape.axis]} AXIS</div>
            </div>
          </Html>
        </>
      ) : (
        <CornerDot position={tape.start} />
      )}
    </group>
  );
}

function TapeMark({ points, width, opacity = 1 }: { points: [Vec3, Vec3]; width: number; opacity?: number }) {
  return (
    <Line
      points={points}
      color={NEON}
      lineWidth={width}
      transparent
      opacity={opacity}
      depthTest={false}
      depthWrite={false}
      toneMapped={false}
      raycast={ignoreRaycast}
      frustumCulled={false}
      renderOrder={opacity < 1 ? 8 : 9}
    />
  );
}

/** World length of `pixels` at `point`, so markers stay the same size on screen. */
function pixelsToWorld(camera: THREE.Camera, point: Vec3, pixels: number, viewportHeight: number): number {
  const height = Math.max(viewportHeight, 1);
  if (camera instanceof THREE.PerspectiveCamera) {
    const depth = new THREE.Vector3(point[0], point[1], point[2]).applyMatrix4(camera.matrixWorldInverse).z;
    const distance = Math.max(0.5, -depth);
    const span = 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
    return (pixels * span) / height;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    return (pixels * ((camera.top - camera.bottom) / camera.zoom)) / height;
  }
  return pixels;
}

/** End bar perpendicular to the measurement, lying in the screen plane. */
function tickPoints(at: Vec3, line: Vec3, camera: THREE.Camera, viewportHeight: number): [Vec3, Vec3] {
  const half = pixelsToWorld(camera, at, TICK_LENGTH_PX / 2, viewportHeight);
  const side = screenTickDirection(line, camera, at);
  return [add(at, scale(side, -half)), add(at, scale(side, half))];
}

function screenTickDirection(line: Vec3, camera: THREE.Camera, point: Vec3): Vec3 {
  const lineDir = normalize(line);
  const toCam = normalize(sub([camera.position.x, camera.position.y, camera.position.z], point));
  let side = cross(lineDir, toCam);
  if (len(side) < 1e-4) {
    const axis: Vec3 = Math.abs(lineDir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    side = cross(lineDir, axis);
  }
  return normalize(side);
}

function projectObject(
  el: THREE.Object3D,
  camera: THREE.Camera,
  size: { width: number; height: number },
): ScreenPoint {
  const world = new THREE.Vector3().setFromMatrixPosition(el.matrixWorld);
  world.project(camera);
  return {
    x: (world.x * 0.5 + 0.5) * size.width,
    y: (-world.y * 0.5 + 0.5) * size.height,
  };
}
