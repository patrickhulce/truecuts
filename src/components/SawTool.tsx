"use client";

import { Html, Line, useCursor } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import type { Polyhedron } from "@/lib/geometry";
import { insideSawOutline, onSawSegment, sawArea, sawSurface, snapSawPoint, splitSawOutline, type SawPoint } from "@/lib/saw";
import { snapSteps } from "@/lib/edit";
import { formatInches } from "@/lib/units";

const CYAN = "#22d3ee";
type Props = {
  faces: Polyhedron;
  fineSnap: boolean;
  onCommit: (outline: SawPoint[]) => string | null;
  onExit: () => void;
};

export function SawTool({ faces, fineSnap, onCommit, onExit }: Props) {
  const { camera, gl } = useThree();
  const group = useRef<THREE.Group>(null);
  const surface = useMemo(() => {
    try { return { ...sawSurface(faces), error: null }; }
    catch (cause) { return { outline: [] as SawPoint[], y: 0, error: String((cause as Error).message) }; }
  }, [faces]);
  const [path, setPath] = useState<SawPoint[]>([]);
  const [hover, setHover] = useState<SawPoint | null>(null);
  const [pieces, setPieces] = useState<[SawPoint[], SawPoint[]] | null>(null);
  const [offcut, setOffcut] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = useRef({ undo: () => {}, exit: onExit });
  useCursor(true, "crosshair");
  useEffect(() => {
    actions.current = {
      undo: () => { setPieces(null); setOffcut(null); setError(null); setPath(points => points.slice(0, -1)); },
      exit: onExit,
    };
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
      if (event.key === "Escape") { event.preventDefault(); actions.current.exit(); }
      if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); event.stopImmediatePropagation(); actions.current.undo(); }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); };
  }, []);

  const latest = useRef({ path, pieces, fineSnap, onCommit, surface });
  useEffect(() => { latest.current = { path, pieces, fineSnap, onCommit, surface }; });
  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const read = (event: PointerEvent): SawPoint | null => {
      const target = group.current;
      if (!target || latest.current.surface.error) return null;
      const rect = canvas.getBoundingClientRect();
      pointer.set(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height);
      raycaster.setFromCamera(pointer, camera);
      target.updateWorldMatrix(true, false);
      const inverse = target.matrixWorld.clone().invert();
      const ray = raycaster.ray.clone().applyMatrix4(inverse);
      if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -latest.current.surface.y), hit)) return null;
      return [hit.x, hit.z];
    };
    const snap = (raw: SawPoint, event: PointerEvent): SawPoint => {
      const { path, surface, fineSnap } = latest.current;
      const world = group.current!.localToWorld(new THREE.Vector3(raw[0], surface.y, raw[1]));
      // Approximately ten screen pixels, independent of zoom or stock dimensions.
      const pixels = canvas.getBoundingClientRect().height;
      const units = camera instanceof THREE.PerspectiveCamera
        ? 2 * world.distanceTo(camera.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / pixels
        : camera instanceof THREE.OrthographicCamera ? (camera.top - camera.bottom) / camera.zoom / pixels : 0.1;
      return snapSawPoint(raw, path.at(-1), surface.outline, snapSteps(fineSnap || event.metaKey || event.ctrlKey).inch, event.shiftKey ? 0 : units * 12);
    };
    const move = (event: PointerEvent) => {
      const raw = read(event);
      if (!raw) { setHover(null); return; }
      const { pieces } = latest.current;
      if (pieces) {
        const index = insideSawOutline(raw, pieces[0]) ? 0 : insideSawOutline(raw, pieces[1]) ? 1 : null;
        if (index !== null) setOffcut(index);
      } else setHover(snap(raw, event));
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const raw = read(event);
      if (!raw) return;
      const { path, pieces, surface, onCommit } = latest.current;
      if (pieces) {
        const index = insideSawOutline(raw, pieces[0]) ? 0 : insideSawOutline(raw, pieces[1]) ? 1 : null;
        if (index === null) return;
        const message = onCommit(pieces[index === 0 ? 1 : 0]);
        if (message) setError(message);
        else { setPath([]); setPieces(null); setHover(null); setOffcut(null); setError(null); }
        return;
      }
      const point = snap(raw, event);
      const onEdge = surface.outline.some((p, i) => onSawSegment(point, p, surface.outline[(i + 1) % surface.outline.length]));
      if (!path.length && !onEdge) { setError("Start on an edge, corner, or midpoint."); return; }
      if (!insideSawOutline(point, surface.outline)) { setError("Keep the cut inside the member and finish on an edge."); return; }
      if (path.length && Math.hypot(point[0] - path[path.length - 1][0], point[1] - path[path.length - 1][1]) < 1e-6) return;
      const next = [...path, point];
      try {
        if (path.length && onEdge) {
          const split = splitSawOutline(surface.outline, next);
          setPieces(split);
          setOffcut(sawArea(split[0]) <= sawArea(split[1]) ? 0 : 1);
        }
        setPath(next); setError(null);
      } catch (cause) { setError((cause as Error).message); }
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", down, true);
    return () => { canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerdown", down, true); };
  }, [camera, gl]);

  const at = (p: SawPoint): [number, number, number] => [p[0], surface.y + 0.02, p[1]];
  const preview = pieces ? path : hover && path.length ? [...path, hover] : path;
  return (
    <group ref={group}>
      {surface.outline.length > 1 && <Line points={[...surface.outline, surface.outline[0]].map(at)} color={CYAN} lineWidth={2} depthTest={false} raycast={() => null} />}
      {preview.length > 1 && <CutPreview points={preview.map(at)} />}
      {hover && !pieces && <mesh position={at(hover)} raycast={() => null}>
        <sphereGeometry args={[0.18, 12, 12]} /><meshBasicMaterial color={CYAN} depthTest={false} />
      </mesh>}
      {pieces && pieces.map((outline, index) => (
        <CutRegion key={index} outline={outline} y={surface.y} discard={index === (offcut ?? 0)} />
      ))}
      <Html fullscreen style={{ pointerEvents: "none" }}>
        <div className="absolute bottom-16 left-16 max-w-sm rounded-lg border border-cyan-700 bg-[#241a10]/95 p-3 text-xs text-[#d6c3a3] shadow-xl" style={{ pointerEvents: "auto" }}>
          <strong className="text-cyan-300">Saw</strong>
          <p className="mt-1">{surface.error ?? (pieces ? "Green KEEP stays. Click the red DISCARD piece to remove it. Hover the other side to swap." : path.length ? "Click to add a corner. Finish on an edge." : "Click an edge to start a cut through the thickness.")}</p>
          <p className="mt-1 text-[#a89070]">45° directions · Corners, midpoints & edges snap · Shift bypasses landmarks</p>
          {hover && !pieces && <p className="mt-1 tabular-nums">L {formatInches(hover[0])} · W {formatInches(hover[1])}</p>}
          {error && <p role="alert" className="mt-1 text-rose-300">{error}</p>}
          <div className="mt-2 flex gap-3">
            <button className="cursor-pointer text-cyan-300 disabled:opacity-40" disabled={!path.length} onClick={() => actions.current.undo()}>Back one point</button>
            <button className="cursor-pointer text-cyan-300" onClick={() => { setPath([]); setPieces(null); setOffcut(null); setError(null); }}>Clear path</button>
            <button className="cursor-pointer text-cyan-300" onClick={onExit}>Done (Esc)</button>
          </div>
        </div>
      </Html>
    </group>
  );
}

/** Screen-sized dashes remain legible while zooming, including on large sheets. */
function CutPreview({ points }: { points: [number, number, number][] }) {
  const dark = useRef<ComponentRef<typeof Line>>(null);
  const halo = useRef<ComponentRef<typeof Line>>(null);
  useFrame(({ camera, size }) => {
    const line = dark.current;
    if (!line) return;
    line.updateWorldMatrix(true, false);
    let pixels = 0;
    let distance = 0;
    let previous: THREE.Vector3 | null = null;
    points.forEach((point, index) => {
      const screen = new THREE.Vector3(...point).applyMatrix4(line.matrixWorld).project(camera);
      screen.set(screen.x * size.width / 2, screen.y * size.height / 2, 0);
      if (previous) {
        pixels += screen.distanceTo(previous);
        distance += new THREE.Vector3(...point).distanceTo(new THREE.Vector3(...points[index - 1]));
      }
      previous = screen;
    });
    const scale = distance > 1e-6 ? pixels / distance : 1;
    line.material.dashScale = scale;
    if (halo.current) halo.current.material.dashScale = scale;
  });
  const shared = {
    points, dashed: true, dashSize: 2, gapSize: 7,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    raycast: () => null,
  };
  return <>
    <Line ref={halo} {...shared} color="#fff7e6" lineWidth={10} renderOrder={30} />
    <Line ref={dark} {...shared} color="#17120e" lineWidth={6} renderOrder={31} />
  </>;
}

function CutRegion({ outline, y, discard }: { outline: SawPoint[]; y: number; discard: boolean }) {
  const { geometry, label } = useMemo(() => {
    const points = outline.map(p => new THREE.Vector2(...p));
    const triangles = THREE.ShapeUtils.triangulateShape(points, []);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(
      triangles.flatMap(tri => tri.flatMap(i => [points[i].x, y + 0.03, points[i].y])), 3,
    ));
    // A triangle incenter stays inside concave pieces, unlike a vertex average.
    let bestRadius = -1;
    let label: [number, number, number] = [outline[0][0], y + 0.04, outline[0][1]];
    for (const tri of triangles) {
      const [a, b, c] = tri.map(i => points[i]);
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a);
      const perimeter = ab + bc + ca;
      const twiceArea = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const radius = twiceArea / perimeter;
      if (radius > bestRadius) {
        bestRadius = radius;
        label = [(bc * a.x + ca * b.x + ab * c.x) / perimeter, y + 0.04, (bc * a.y + ca * b.y + ab * c.y) / perimeter];
      }
    }
    return { geometry, label };
  }, [outline, y]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const color = discard ? "#ff2020" : "#00db48";
  return <group>
    <mesh geometry={geometry} raycast={() => null} renderOrder={20}>
      <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
    <Line
      points={[...outline, outline[0]].map(p => [p[0], y + 0.04, p[1]])}
      color={color} lineWidth={3} transparent depthTest={false} depthWrite={false} toneMapped={false}
      renderOrder={21} raycast={() => null}
    />
    <Html position={label} center style={{ pointerEvents: "none" }} zIndexRange={[30, 20]}>
      <div
        className="rounded border-2 border-white px-3 py-1.5 text-sm font-black tracking-widest text-white shadow-[0_2px_8px_#000a] select-none"
        style={{ background: discard ? "#d00000" : "#007f2b" }}
      >
        {discard ? "DISCARD" : "KEEP"}
      </div>
    </Html>
  </group>;
}
