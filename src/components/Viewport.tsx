"use client";

import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, events as canvasEvents } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type DragEvent as ReactDragEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import * as THREE from "three";
import { prioritizeGizmoHits } from "@/lib/gizmo-interaction";
import { frameCamera } from "@/lib/camera-frame";
import { isolateScene } from "@/lib/isolate";
import {
  orbitPreviewOffset,
  resolveExportPose,
  type ExportCamera,
  type OrbitSnapshot,
  type ViewportExportApi,
} from "@/lib/export-view";
import { getCatalogPart, resolveStockSize, stockGeometry } from "@/lib/catalog";
import { freeAxes } from "@/lib/catalog-families";
import { connectionContactPairs } from "@/lib/connections";
import {
  CATALOG_DRAG_MIME,
  draftMemberResize,
  parseCatalogDrag,
  SNAP_INCH,
  snapValue,
  type NewMemberInput,
} from "@/lib/edit";
import { parseInstanceKey } from "@/lib/fasteners";
import {
  aabbInFrame,
  add,
  axisCoord,
  boundingBox,
  localPoseFromWorld,
  nearInstanceKeys,
  patchesFor,
  patchNeighbor,
  posedAabb,
  rotateEulerXYZ,
  translateByWorldDelta,
  unionAabb,
  type Aabb,
  type Polyhedron,
  type SharedPatch,
  type Vec3,
} from "@/lib/geometry";
import { aabbCorners, projectedBoxHitsRect, type ScreenRect } from "@/lib/marquee";
import { canSelectComponent, componentIdOfSelection, componentSelectionKey, hitSelectionKey, type SelectionMode } from "@/lib/selection";
import type { ResolvedBore, ResolvedMember } from "@/lib/schema";
import {
  computeExplodeOffsets,
  findSceneComponent,
  findSceneParent,
  membersUnder,
  meshMember,
  sceneMembers,
  walkSceneComponents,
  type SceneComponent,
  type SceneConnection,
  type SceneFastener,
  type SceneModel,
  type SceneMemberInstance,
} from "@/lib/scene";
import { sceneMeasureTargets } from "@/lib/measure";
import { formatInches } from "@/lib/units";
import { ConnectionFaceOverlay, ContactOverlay } from "./ContactOverlay";
import { FastenerMesh } from "./FastenerMesh";
import { PartGizmo, type PartPose } from "./PartGizmo";
import { MeasurementOverlay } from "./MeasurementOverlay";
import { MemberMesh } from "./MemberMesh";
import { RenderAlertOverlay, useRenderAlert } from "./RenderAlert";
import { CameraToolbar, RendererToolbar } from "./RendererToolbar";
import { SawTool } from "./SawTool";
import type { SawPoint } from "@/lib/saw";
import { ResizeGizmo } from "./ResizeGizmo";

type DraftPose = PartPose & { key: string };

type ResizePreview = {
  key: string;
  faces: Polyhedron;
  bounds: { min: Vec3; max: Vec3 };
  position: Vec3;
};

type ResizeUpdate = {
  memberId: string;
  axis: 0 | 1 | 2;
  side: "start" | "end";
  inches: number;
};

type PoseUpdate = {
  componentId: string;
  placementIndex: number;
  position: Vec3;
  rotation: Vec3;
};

type ComponentPoseUpdate = {
  componentId: string;
  position: Vec3;
  rotation: Vec3;
};

type ViewportProps = {
  scene?: SceneModel;
  selectedKeys: string[];
  selectionMode: SelectionMode;
  hoveredKeys: readonly string[];
  onSelect: (key: string | null, options?: { shift?: boolean; member?: boolean }) => void;
  onMarqueeSelect: (keys: string[], options?: { member?: boolean }) => void;
  onDeleteMembers?: (memberIds: string[]) => void;
  onDeletePlacements?: (keys: string[]) => void;
  onDeleteComponents?: (occurrenceIds: string[]) => void;
  onChangePoses?: (updates: PoseUpdate[]) => void;
  onChangeComponentPose?: (updates: ComponentPoseUpdate[]) => void;
  activeConnection?: SceneConnection | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  showContacts: boolean;
  onShowContacts: (value: boolean) => void;
  showUnattached: boolean;
  onShowUnattached: (value: boolean) => void;
  fineSnap?: boolean;
  /** Inches. Bores smaller than this are omitted from the mesh. */
  boreDiameter: number;
  onPlaceMember?: (input: NewMemberInput, position: Vec3) => void;
  members?: ResolvedMember[];
  onResizeMember?: (update: ResizeUpdate) => string | null;
  onSawMember?: (memberId: string, outline: SawPoint[]) => string | null;
  exportApiRef?: RefObject<ViewportExportApi | null>;
  /** Occurrence shown alone, in its own frame. Null is the full build. */
  isolatedId?: string | null;
  onEnterIsolation?: (occurrenceId: string) => void;
};

const ZERO: Vec3 = [0, 0, 0];
const MARQUEE_SLOP = 4;

function projectToRoot(
  point: Vec3,
  camera: THREE.Camera,
  canvas: DOMRect,
  root: DOMRect,
): { x: number; y: number } | null {
  const vector = new THREE.Vector4(point[0], point[1], point[2], 1);
  vector.applyMatrix4(camera.matrixWorldInverse);
  vector.applyMatrix4(camera.projectionMatrix);
  if (vector.w <= 1e-6) return null;
  const ndcX = vector.x / vector.w;
  const ndcY = vector.y / vector.w;
  const clientX = (ndcX * 0.5 + 0.5) * canvas.width + canvas.left;
  const clientY = (-ndcY * 0.5 + 0.5) * canvas.height + canvas.top;
  return { x: clientX - root.left, y: clientY - root.top };
}

function membersInMarquee(
  scene: SceneModel,
  offsets: Map<string, Vec3>,
  camera: THREE.Camera,
  canvas: DOMRect,
  root: DOMRect,
  rect: ScreenRect,
  member = false,
): string[] {
  camera.updateMatrixWorld();
  const keys: string[] = [];
  const seen = new Set<string>();
  walkSceneComponents(scene.components, (component) => {
    for (const part of component.members) {
      const corners = aabbCorners(part.worldBounds, offsets.get(part.key) ?? ZERO);
      if (!projectedBoxHitsRect(corners, (point) => projectToRoot(point, camera, canvas, root), rect)) continue;
      const key = member || !canSelectComponent(component) ? part.key : componentSelectionKey(component.id);
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  });
  return keys;
}

function componentLocalBounds(component: SceneComponent): Aabb | null {
  const boxes = component.members.map((part) => posedAabb(part.bounds, part.position, part.rotation));
  for (const child of component.children) {
    const inner = componentLocalBounds(child);
    if (inner) boxes.push(posedAabb(inner, child.position, child.rotation));
  }
  return unionAabb(boxes);
}
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const GIMBAL_REST: [string, string, string] = ["#b45309", "#ca8a04", "#92400e"];
const GIMBAL_DIM = "#5c3d1e";
const GIMBAL_HOT = "#fbbf24";

function gimbalAxisColors(axis: 0 | 1 | 2 | null): [string, string, string] {
  if (axis === null) return GIMBAL_REST;
  return [axis === 0 ? GIMBAL_HOT : GIMBAL_DIM, axis === 1 ? GIMBAL_HOT : GIMBAL_DIM, axis === 2 ? GIMBAL_HOT : GIMBAL_DIM];
}

function hasCatalogDrag(data: DataTransfer): boolean {
  return Array.from(data.types).includes(CATALOG_DRAG_MIME);
}

function floorDropPoint(event: ReactDragEvent, camera: THREE.Camera): Vec3 | null {
  const canvas = event.currentTarget.querySelector("canvas");
  const rect = (canvas ?? event.currentTarget).getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(FLOOR, hit)) return null;
  if (hit.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction) <= 0) return null;
  return [snapValue(hit.x, SNAP_INCH), 0, snapValue(hit.z, SNAP_INCH)];
}

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
    <aside className="pointer-events-none absolute bottom-4 left-4 max-w-sm rounded-md border border-[#3d2a18] bg-[#241a10]/95 px-3 py-2 text-xs text-[#d6c3a3] shadow-lg">
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

function MultiSelectionCard({ instances }: { instances: SceneMemberInstance[] }) {
  const count = instances.length;
  return (
    <aside className="pointer-events-none absolute bottom-4 left-4 max-w-sm rounded-md border border-[#3d2a18] bg-[#241a10]/95 px-3 py-2 text-xs text-[#d6c3a3] shadow-lg">
      <div className="font-medium text-[#f59e0b]">
        {count} {count === 1 ? "member" : "members"}
      </div>
      <p className="mt-1 line-clamp-6 text-[#d6c3a3]">{instances.map((instance) => instance.label).join(", ")}</p>
    </aside>
  );
}

export function Viewport({
  scene: documentScene,
  selectedKeys,
  selectionMode,
  hoveredKeys,
  onSelect,
  onMarqueeSelect,
  onDeleteMembers,
  onDeletePlacements,
  onDeleteComponents,
  onChangePoses,
  onChangeComponentPose,
  activeConnection = null,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  showContacts,
  onShowContacts,
  showUnattached,
  onShowUnattached,
  fineSnap = false,
  boreDiameter,
  onPlaceMember,
  members = [],
  onResizeMember,
  onSawMember,
  exportApiRef,
  isolatedId = null,
  onEnterIsolation,
}: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);
  const captureGate = useRef<{ resolve: () => void } | null>(null);
  const capturingRef = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const draggingRef = useRef(false);
  const marqueeDataRef = useRef({
    scene: undefined as SceneModel | undefined,
    worldOffsets: new Map<string, Vec3>(),
    onMarqueeSelect,
    enabled: false,
  });
  const [dropOver, setDropOver] = useState(false);
  const [explode, setExplode] = useState(0);
  const [dragging, setDraggingState] = useState(false);
  const [marquee, setMarquee] = useState<ScreenRect | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const setDragActive = (active: boolean) => {
    draggingRef.current = active;
    setDraggingState(active);
  };
  const [draft, setDraft] = useState<DraftPose | null>(null);
  const [groupDraft, setGroupDraft] = useState<Vec3 | null>(null);
  const [componentDraft, setComponentDraft] = useState<ComponentPoseUpdate | null>(null);
  const [focusedPatch, setFocusedPatch] = useState<string | null>(null);
  const [pan, setPan] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const frameableRef = useRef(false);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [resize, setResize] = useState(false);
  const [saw, setSaw] = useState(false);
  const [measure, setMeasure] = useState(false);
  const [activeMeasuredAxis, setActiveMeasuredAxis] = useState<0 | 1 | 2 | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const { alert, show } = useRenderAlert();
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const scene = useMemo(() => {
    if (!documentScene || !isolatedId || capturing) return documentScene;
    return isolateScene(documentScene, isolatedId) ?? documentScene;
  }, [capturing, documentScene, isolatedId]);
  const savedOrbit = useRef<(OrbitSnapshot & { near: number; far: number }) | null>(null);
  const isolatedBefore = useRef<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTextField(event.target)) return;
      if (event.key === "Home") {
        if (!frameableRef.current) return;
        event.preventDefault();
        setResetToken((token) => token + 1);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "escape") { setSaw(false); return; }
      if (key !== "p" && key !== "r" && key !== "m") return;
      event.preventDefault();
      setSaw(false);
      setDragActive(false);
      setDraft(null);
      setGroupDraft(null);
      setComponentDraft(null);
      setResizePreview(null);
      if (key === "p") {
        setPan((current) => !current);
        setResize(false);
        setMeasure(false);
        return;
      }
      if (key === "m") {
        setMeasure((current) => !current);
        setPan(false);
        setResize(false);
        return;
      }
      setResize((current) => !current);
      setPan(false);
      setMeasure(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Shift") setShiftHeld(true);
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Shift") setShiftHeld(event.shiftKey);
    };
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    if (!grabbing) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    const stop = () => setGrabbing(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      document.body.style.cursor = previous;
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [grabbing]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const soleKey = selectedKeys.length === 1 ? selectedKeys[0] : null;
  const componentSelectionId = soleKey ? componentIdOfSelection(soleKey) : null;
  const memberKey = soleKey && componentSelectionId === null ? soleKey : null;
  const singleKey = selectionMode === "single" ? memberKey : null;
  const hasSelection = selectedKeys.length > 0;
  const selectedMemberKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!scene) return keys;
    for (const key of selectedKeys) {
      const occurrenceId = componentIdOfSelection(key);
      if (!occurrenceId) {
        keys.add(key);
        continue;
      }
      const component = findSceneComponent(scene.components, occurrenceId);
      if (!component) continue;
      for (const member of membersUnder(component)) keys.add(member.key);
    }
    return keys;
  }, [scene, selectedKeys]);
  const hoveredMemberKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!scene) return keys;
    for (const key of hoveredKeys) {
      const occurrenceId = componentIdOfSelection(key);
      if (!occurrenceId) {
        keys.add(key);
        continue;
      }
      const component = findSceneComponent(scene.components, occurrenceId);
      if (!component) continue;
      for (const member of membersUnder(component)) keys.add(member.key);
    }
    return keys;
  }, [hoveredKeys, scene]);
  const selected = memberKey ? sceneMembers(scene?.components ?? []).find((part) => part.key === memberKey) : undefined;
  const activeDraft = draft?.key === soleKey ? draft : null;

  const posed = (part: SceneMemberInstance, componentRotation: Vec3): SceneMemberInstance => {
    let next = part;
    if (resizePreview?.key === part.key) {
      const { bounds } = resizePreview;
      next = {
        ...part,
        position: resizePreview.position,
        faces: resizePreview.faces,
        bounds,
        finished: {
          length: bounds.max[0] - bounds.min[0],
          width: bounds.max[2] - bounds.min[2],
          thickness: bounds.max[1] - bounds.min[1],
        },
      };
    }
    if (activeDraft?.key === part.key) {
      return { ...next, position: activeDraft.position, rotation: activeDraft.rotation };
    }
    if (groupDraft && selectedSet.has(part.key)) {
      return { ...next, position: translateByWorldDelta(part.position, componentRotation, groupDraft) };
    }
    return next;
  };

  const clearResizeDrag = () => {
    setDragActive(false);
    setResizePreview(null);
  };

  const previewResize = (axis: 0 | 1 | 2, side: "start" | "end", inches: number): boolean => {
    if (!selected) return false;
    const definition = memberById.get(selected.memberId);
    const stock = definition ? getCatalogPart(definition.stock) : undefined;
    if (!definition || !stock) return false;
    try {
      const drafted = draftMemberResize(stock, definition.size, definition.cuts, axis, inches, side);
      const size = drafted.kind === "size" ? resolveStockSize(stock, drafted.size).size : definition.size;
      const cuts = (drafted.kind === "cuts" ? drafted.cuts : definition.cuts).map((cut) => ({
        ...cut,
        side: cut.side ?? ("end" as const),
      }));
      const faces = meshMember({ ...definition, size, cuts }, stock);
      const shift = drafted.kind === "cuts" ? drafted.shift : 0;
      const along: Vec3 = [0, 0, 0];
      along[axisCoord(axis)] = shift;
      setResizePreview({
        key: selected.key,
        faces,
        bounds: boundingBox(faces),
        position: add(selected.position, rotateEulerXYZ(along, selected.rotation)),
      });
      return true;
    } catch (cause) {
      clearResizeDrag();
      show("error", cause instanceof Error ? cause.message : "Could not resize the member");
      return false;
    }
  };

  const commitResize = (axis: 0 | 1 | 2, side: "start" | "end", inches: number) => {
    clearResizeDrag();
    if (!selected || !onResizeMember) return;
    const message = onResizeMember({ memberId: selected.memberId, axis, side, inches });
    if (message) show("error", message);
  };

  const gizmoPose: PartPose | undefined = selected
    ? activeDraft
      ? activeDraft
      : { position: selected.position, rotation: selected.rotation }
    : undefined;

  const selectPart = (key: string | null, options?: { shift?: boolean; member?: boolean }) => {
    setDraft(null);
    setGroupDraft(null);
    setComponentDraft(null);
    setDragActive(false);
    setResizePreview(null);
    setFocusedPatch(null);
    if (!key) {
      onSelect(key, options);
      return;
    }
    const component = scene ? findSceneComponent(scene.components, parseInstanceKey(key).componentId) : undefined;
    const hit = hitSelectionKey({ keys: selectedKeys, mode: selectionMode }, key, { member: options?.member, component });
    onSelect(hit, { ...options, member: componentIdOfSelection(hit) === null });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")) {
      return;
    }
    rootRef.current?.focus();
    if (pan && event.button === 0 && event.target instanceof HTMLCanvasElement) setGrabbing(true);
    const data = marqueeDataRef.current;
    if (!data.enabled || event.button !== 0 || !event.shiftKey) return;
    if (!(event.target instanceof HTMLCanvasElement) || draggingRef.current) return;

    const originX = event.clientX;
    const originY = event.clientY;
    const pointerId = event.pointerId;
    let armed = false;
    let rect: ScreenRect | null = null;

    const toLocal = (clientX: number, clientY: number) => {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds) return { x: clientX, y: clientY };
      return { x: clientX - bounds.left, y: clientY - bounds.top };
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      setMarquee(null);
    };

    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (!armed && draggingRef.current) {
        cleanup();
        return;
      }
      const dx = pointer.clientX - originX;
      const dy = pointer.clientY - originY;
      if (!armed && dx * dx + dy * dy < MARQUEE_SLOP * MARQUEE_SLOP) return;
      armed = true;
      const start = toLocal(originX, originY);
      const end = toLocal(pointer.clientX, pointer.clientY);
      rect = { x0: start.x, y0: start.y, x1: end.x, y1: end.y };
      setMarquee(rect);
    };

    const finish = (member: boolean) => {
      const hit = rect;
      const root = rootRef.current;
      const camera = cameraRef.current;
      const canvas = root?.querySelector("canvas");
      const live = marqueeDataRef.current;
      cleanup();
      if (!hit || !root || !camera || !(canvas instanceof HTMLCanvasElement) || !live.scene) return;
      const keys = membersInMarquee(
        live.scene,
        live.worldOffsets,
        camera,
        canvas.getBoundingClientRect(),
        root.getBoundingClientRect(),
        hit,
        member,
      );
      setDraft(null);
      setGroupDraft(null);
      setComponentDraft(null);
      setDragActive(false);
      setResizePreview(null);
      setFocusedPatch(null);
      live.onMarqueeSelect(keys, { member });
    };

    const up = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (!armed) {
        cleanup();
        return;
      }
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      finish(!(pointer.metaKey || pointer.ctrlKey));
    };

    const cancel = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      cleanup();
    };

    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
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
    if (selectedKeys.length === 0 || !scene) return;
    const occurrenceIds = selectedKeys.flatMap((key) => {
      const id = componentIdOfSelection(key);
      return id ? [id] : [];
    });
    const placements = selectedKeys.filter((key) => componentIdOfSelection(key) === null);
    if (occurrenceIds.length > 0 && onDeleteComponents) {
      event.preventDefault();
      onDeleteComponents(occurrenceIds);
      return;
    }
    if (placements.length > 0 && onDeletePlacements) {
      event.preventDefault();
      onDeletePlacements(placements);
      return;
    }
    if (!onDeleteMembers || placements.length === 0) return;
    const memberIds = sceneMembers(scene.components)
      .filter((part) => placements.includes(part.key))
      .map((part) => part.memberId);
    if (memberIds.length === 0) return;
    event.preventDefault();
    onDeleteMembers(memberIds);
  };

  const commitDraft = (position: Vec3, rotation: Vec3) => {
    setDragActive(false);
    if (selected && onChangePoses) {
      const { componentId, placementIndex } = parseInstanceKey(selected.key);
      onChangePoses([{ componentId, placementIndex, position, rotation }]);
    }
    setDraft(null);
  };

  const commitGroup = (delta: Vec3) => {
    setDragActive(false);
    setGroupDraft(null);
    if (!scene || !onChangePoses) return;
    const updates: PoseUpdate[] = [];
    walkSceneComponents(scene.components, (component) => {
      for (const part of component.members) {
        if (!selectedSet.has(part.key)) continue;
        const { componentId, placementIndex } = parseInstanceKey(part.key);
        updates.push({
          componentId,
          placementIndex,
          position: translateByWorldDelta(part.position, component.worldRotation, delta),
          rotation: [part.rotation[0], part.rotation[1], part.rotation[2]],
        });
      }
    });
    if (updates.length > 0) onChangePoses(updates);
  };

  const commitComponentGroup = (delta: Vec3) => {
    setDragActive(false);
    setGroupDraft(null);
    if (!scene || !onChangeComponentPose) return;
    const updates: ComponentPoseUpdate[] = [];
    for (const id of componentSelection) {
      const component = findSceneComponent(scene.components, id);
      if (!component) continue;
      const parent = findSceneParent(scene.components, id);
      const worldPosition = add(component.worldPosition, delta);
      const local = parent
        ? localPoseFromWorld(worldPosition, component.worldRotation, parent.worldPosition, parent.worldRotation)
        : { position: worldPosition, rotation: component.worldRotation };
      updates.push({ componentId: id, position: local.position, rotation: local.rotation });
    }
    if (updates.length > 0) onChangeComponentPose(updates);
  };

  const attachedFasteners = useMemo(() => {
    if (!scene || !singleKey) return [];
    return scene.fasteners.filter((fastener) =>
      fastener.members.some((member) => member.instanceKey === singleKey),
    );
  }, [scene, singleKey]);

  const attachedKeys = useMemo(
    () => new Set(attachedFasteners.map((fastener) => fastener.key)),
    [attachedFasteners],
  );

  const selectedPatches = useMemo(
    () => (scene && singleKey ? patchesFor(scene.contacts, singleKey) : []),
    [scene, singleKey],
  );

  const editedPatches = useMemo(() => {
    if (!scene || !singleKey || !activeConnection) return [];
    const pairs = connectionContactPairs(activeConnection);
    return scene.contacts.patches.filter((patch) => {
      const a = patch.a.instanceKey;
      const b = patch.b.instanceKey;
      if (a !== singleKey && b !== singleKey) return false;
      return pairs.some(([left, right]) => (a === left && b === right) || (a === right && b === left));
    });
  }, [activeConnection, scene, singleKey]);

  const editedPatchKeys = useMemo(() => editedPatches.map((patch) => patch.key), [editedPatches]);

  const partByKey = useMemo(() => {
    const map = new Map<string, SceneMemberInstance>();
    if (!scene) return map;
    for (const part of sceneMembers(scene.components)) map.set(part.key, part);
    return map;
  }, [scene]);

  const neighborLabels = useMemo(() => {
    if (!singleKey) return [];
    const keys: string[] = [];
    const seen = new Set<string>();
    const add = (key: string) => {
      if (key === singleKey || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    };
    for (const patch of selectedPatches) add(patchNeighbor(patch, singleKey).instanceKey);
    for (const key of nearInstanceKeys(singleKey, [...partByKey.values()])) add(key);
    const labels = keys.map((key) => partByKey.get(key)?.label ?? key);
    const counts = new Map<string, number>();
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    return keys.map((key, index) => {
      const label = labels[index] ?? key;
      if ((counts.get(label) ?? 0) < 2) return label;
      const id = partByKey.get(key)?.memberId ?? key;
      return `${label} (${id})`;
    });
  }, [partByKey, singleKey, selectedPatches]);

  const snapTargets = useMemo(() => {
    if (!scene || !memberKey) return [];
    const { componentId } = parseInstanceKey(memberKey);
    const component = findSceneComponent(scene.components, componentId);
    if (!component) return [];
    const targets: Aabb[] = [];
    for (const part of sceneMembers(scene.components)) {
      if (part.key === memberKey) continue;
      targets.push(aabbInFrame(part.worldBounds, component.worldPosition, component.worldRotation));
    }
    return targets;
  }, [memberKey, scene]);

  const memberSelection = useMemo(
    () => selectedKeys.filter((key) => componentIdOfSelection(key) === null),
    [selectedKeys],
  );
  const componentSelection = useMemo(
    () => selectedKeys.flatMap((key) => {
      const id = componentIdOfSelection(key);
      return id ? [id] : [];
    }),
    [selectedKeys],
  );

  const groupBounds = useMemo(() => {
    if (!scene || memberSelection.length < 2 || componentSelection.length > 0) return null;
    const boxes: Aabb[] = [];
    for (const part of sceneMembers(scene.components)) {
      if (selectedSet.has(part.key)) boxes.push(part.worldBounds);
    }
    return unionAabb(boxes);
  }, [componentSelection.length, memberSelection.length, scene, selectedSet]);

  const selectedComponent = useMemo(() => {
    if (!scene || !componentSelectionId || selectionMode !== "single") return null;
    return findSceneComponent(scene.components, componentSelectionId) ?? null;
  }, [componentSelectionId, scene, selectionMode]);

  const componentGroupBounds = useMemo(() => {
    if (!scene || componentSelection.length < 2) return null;
    const boxes: Aabb[] = [];
    for (const id of componentSelection) {
      const component = findSceneComponent(scene.components, id);
      if (!component) continue;
      for (const part of membersUnder(component)) boxes.push(part.worldBounds);
    }
    return unionAabb(boxes);
  }, [componentSelection, scene]);

  const rigidBounds = useMemo(() => {
    if (!selectedComponent) return null;
    return componentLocalBounds(selectedComponent);
  }, [selectedComponent]);

  const groupSnapTargets = useMemo(() => {
    if (!scene || (memberSelection.length < 2 && componentSelection.length < 2)) return [];
    const hidden = new Set(selectedMemberKeys);
    const targets: Aabb[] = [];
    for (const part of sceneMembers(scene.components)) {
      if (!hidden.has(part.key)) targets.push(part.worldBounds);
    }
    return targets;
  }, [componentSelection.length, memberSelection.length, scene, selectedMemberKeys]);

  const buildBounds = useMemo(() => {
    if (!scene) return null;
    return unionAabb(sceneMembers(scene.components).map((part) => part.worldBounds));
  }, [scene]);
  useEffect(() => {
    frameableRef.current = buildBounds !== null;
  }, [buildBounds]);

  const worldOffsets = useMemo(
    () => (scene ? computeExplodeOffsets(scene, explode) : new Map<string, Vec3>()),
    [scene, explode],
  );
  const measureTargets = useMemo(
    () => (scene && measure ? sceneMeasureTargets(scene, worldOffsets) : { corners: [], edges: [] }),
    [measure, scene, worldOffsets],
  );
  useEffect(() => {
    marqueeDataRef.current = {
      scene,
      worldOffsets,
      onMarqueeSelect,
      enabled: !pan && !resize && !measure && !saw,
    };
  }, [measure, onMarqueeSelect, pan, resize, saw, scene, worldOffsets]);

  useLayoutEffect(() => {
    if (!capturing) return;
    const gate = captureGate.current;
    captureGate.current = null;
    gate?.resolve();
  }, [capturing]);

  const readOrbit = useCallback((): OrbitSnapshot | null => {
    const view = cameraRef.current;
    const orbit = controlsRef.current;
    if (!(view instanceof THREE.PerspectiveCamera) || !orbit) return null;
    return {
      position: [view.position.x, view.position.y, view.position.z],
      target: [orbit.target.x, orbit.target.y, orbit.target.z],
      fov: view.fov,
    };
  }, []);

  useEffect(() => {
    const next = isolatedId;
    const prev = isolatedBefore.current;
    if (prev === next) return;
    isolatedBefore.current = next;
    if (!prev && next) {
      const orbit = readOrbit();
      const camera = cameraRef.current;
      if (orbit && camera instanceof THREE.PerspectiveCamera) {
        savedOrbit.current = { ...orbit, near: camera.near, far: camera.far };
      }
      setFocusToken((token) => token + 1);
      return;
    }
    if (prev && !next) {
      const saved = savedOrbit.current;
      savedOrbit.current = null;
      const camera = cameraRef.current;
      const orbit = controlsRef.current;
      if (saved && camera instanceof THREE.PerspectiveCamera && orbit) {
        camera.position.set(saved.position[0], saved.position[1], saved.position[2]);
        camera.near = saved.near;
        camera.far = saved.far;
        camera.fov = saved.fov;
        camera.updateProjectionMatrix();
        orbit.target.set(saved.target[0], saved.target[1], saved.target[2]);
        orbit.update();
      }
      return;
    }
    if (next) setFocusToken((token) => token + 1);
  }, [isolatedId, readOrbit]);

  const previewExport = useCallback((camera: ExportCamera, bounds: Aabb) => {
    const view = cameraRef.current;
    const orbit = controlsRef.current;
    const gl = glRef.current;
    if (!(view instanceof THREE.PerspectiveCamera) || !orbit || !gl) return;
    const width = gl.domElement.clientWidth;
    const height = gl.domElement.clientHeight;
    const aspect = width > 0 && height > 0 ? width / height : 1;
    const pose = resolveExportPose(camera, bounds, aspect);
    const length = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    const offset = orbitPreviewOffset(camera.azimuthDeg, camera.elevationDeg, length);
    orbit.target.set(pose.target[0], pose.target[1], pose.target[2]);
    view.up.set(0, 1, 0);
    view.position.set(pose.target[0] + offset[0], pose.target[1] + offset[1], pose.target[2] + offset[2]);
    view.fov = pose.fov;
    view.near = pose.near;
    view.far = pose.far;
    view.aspect = aspect;
    view.updateProjectionMatrix();
    orbit.update();
    view.fov = pose.fov;
    view.near = pose.near;
    view.far = pose.far;
    view.aspect = aspect;
    view.updateProjectionMatrix();
    invalidateRef.current?.();
  }, []);

  const captureExport = useCallback(async (
    cameras: readonly ExportCamera[],
    bounds: Aabb,
    sizes: readonly { width: number; height: number }[],
  ): Promise<HTMLCanvasElement[]> => {
    const gl = glRef.current;
    const threeScene = threeSceneRef.current;
    if (!gl || !threeScene) throw new Error("The view is not ready yet");
    if (sizes.length !== cameras.length || sizes.some((size) => size.width < 1 || size.height < 1)) {
      throw new Error("The sheet cell has no size");
    }
    if (capturingRef.current) throw new Error("An export is already running");
    capturingRef.current = true;
    setCapturing(true);
    try {
      await new Promise<void>((resolve) => {
        captureGate.current = { resolve };
      });
      return renderStills(gl, threeScene, cameras, bounds, sizes);
    } finally {
      capturingRef.current = false;
      setCapturing(false);
      invalidateRef.current?.();
    }
  }, []);

  useLayoutEffect(() => {
    if (!exportApiRef) return;
    const api: ViewportExportApi = { readOrbit, preview: previewExport, capture: captureExport };
    exportApiRef.current = api;
    return () => {
      if (exportApiRef.current === api) exportApiRef.current = null;
    };
  }, [captureExport, exportApiRef, previewExport, readOrbit]);

  const renderOccurrence = (components: SceneComponent[], parent: SceneComponent | null) =>
    components.map((component) => {
      const worldDraft = componentDraft?.componentId === component.id ? componentDraft : null;
      const grouped = Boolean(groupDraft && componentSelection.length >= 2 && componentSelection.includes(component.id));
      const worldPosition = grouped ? add(component.worldPosition, groupDraft ?? ZERO) : (worldDraft?.position ?? component.worldPosition);
      const worldRotation = worldDraft?.rotation ?? component.worldRotation;
      const drafted = Boolean(worldDraft || grouped);
      const local = drafted
        ? parent
          ? localPoseFromWorld(worldPosition, worldRotation, parent.worldPosition, parent.worldRotation)
          : { position: worldPosition, rotation: worldRotation }
        : null;
      const componentPosition = local?.position ?? component.position;
      const componentRotation = local?.rotation ?? component.rotation;
      const qInv = quaternionInverse(worldRotation);
      const showGizmo = Boolean(
        !capturing &&
          selected &&
          gizmoPose &&
          onChangePoses &&
          !resize &&
          !saw &&
          !measure &&
          parseInstanceKey(selected.key).componentId === component.id,
      );
      const resizeDefinition = selected ? memberById.get(selected.memberId) : undefined;
      const resizeStock = resizeDefinition ? getCatalogPart(resizeDefinition.stock) : undefined;
      const resizeGeometry = resizeStock ? stockGeometry(resizeStock) : undefined;
      const resizeCuttable = resizeGeometry === "box" || resizeGeometry === "rod";
      const resizeFreeAxes = (resizeStock ? freeAxes(resizeStock) : []).flatMap((spec) =>
        spec.axis === "L" ? [0 as const] : spec.axis === "W" ? [1 as const] : [2 as const],
      );
      const showResize = Boolean(
        !capturing &&
          resize &&
          !pan &&
          !measure &&
          selected &&
          gizmoPose &&
          resizeDefinition &&
          parseInstanceKey(selected.key).componentId === component.id,
      );
      return (
        <group key={component.id} position={componentPosition} rotation={deg(componentRotation)}>
          {component.members.map((part) => (
            <MemberMesh
              key={part.key}
              instance={posed(part, component.worldRotation)}
              selected={!capturing && selectedMemberKeys.has(part.key)}
              preview={!capturing && hoveredMemberKeys.has(part.key) && !selectedMemberKeys.has(part.key)}
              muted={!capturing && part.key === singleKey && activeConnection !== null}
              dimmed={
                !capturing &&
                !selectedMemberKeys.has(part.key) &&
                !hoveredMemberKeys.has(part.key) &&
                (hasSelection || hoveredMemberKeys.size > 0)
              }
              offset={toLocalOffset(worldOffsets.get(part.key) ?? ZERO, qInv)}
              interactive={!pan && !measure && !saw}
              boreDiameter={boreDiameter}
              showUnattached={showUnattached}
              onSelect={selectPart}
              onDoubleClick={(key) => {
                try {
                  const componentId = parseInstanceKey(key).componentId;
                  const component = scene && findSceneComponent(scene.components, componentId);
                  if (component && canSelectComponent(component)) onEnterIsolation?.(componentId);
                } catch {
                  // A key that is not a member placement cannot be opened.
                }
              }}
            />
          ))}
          {renderOccurrence(component.children, component)}
          {saw && !capturing && selected && onSawMember && parseInstanceKey(selected.key).componentId === component.id ? (
            <group position={selected.position} rotation={deg(selected.rotation)}>
              <SawTool
                key={selected.key + JSON.stringify(selected.faces)}
                faces={selected.faces}
                fineSnap={fineSnap}
                onCommit={outline => onSawMember(selected.memberId, outline)}
                onExit={() => setSaw(false)}
              />
            </group>
          ) : null}
          {showResize && resizeDefinition && selected ? (
            <group position={toLocalOffset(worldOffsets.get(selected.key) ?? ZERO, qInv)}>
              <group position={selected.position} rotation={deg(selected.rotation)}>
                <ResizeGizmo
                  key={selected.key}
                  bounds={selected.bounds}
                  cuttable={resizeCuttable}
                  freeAxes={resizeFreeAxes}
                  fineSnap={fineSnap}
                  position={selected.position}
                  rotation={selected.rotation}
                  snapTargets={snapTargets}
                  onDragStart={() => setDragActive(true)}
                  onDraft={previewResize}
                  onCommit={commitResize}
                  onCancel={clearResizeDrag}
                />
              </group>
            </group>
          ) : null}
          {showGizmo && !pan && selected && gizmoPose ? (
            <group position={toLocalOffset(worldOffsets.get(selected.key) ?? ZERO, qInv)}>
              <PartGizmo
                key={`${selected.key}-${selected.position.join(",")}-${selected.rotation.join(",")}`}
                pose={gizmoPose}
                bounds={selected.bounds}
                snapTargets={snapTargets}
                fineSnap={fineSnap}
                onDragStart={() => setDragActive(true)}
                onDraft={(position, rotation) => setDraft({ key: selected.key, position, rotation })}
                onCommit={commitDraft}
              />
            </group>
          ) : null}
        </group>
      );
    });

  return (
    <div
      ref={rootRef}
      data-model-viewport
      tabIndex={0}
      className={`relative h-full w-full bg-[#1a120b] outline-none ${dropOver ? "ring-2 ring-[#f59e0b] ring-inset" : ""} ${pan ? "cursor-grab" : ""}`}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDragEnter={(event) => {
        if (!hasCatalogDrag(event.dataTransfer)) return;
        event.preventDefault();
        setDropOver(true);
      }}
      onDragOver={(event) => {
        if (!hasCatalogDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropOver(true);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDropOver(false);
      }}
      onDrop={(event) => {
        if (!hasCatalogDrag(event.dataTransfer)) return;
        event.preventDefault();
        setDropOver(false);
        const camera = cameraRef.current;
        if (!camera || !onPlaceMember) return;
        const input = parseCatalogDrag(event.dataTransfer.getData(CATALOG_DRAG_MIME));
        const position = floorDropPoint(event, camera);
        if (!input || !position) return;
        onPlaceMember(input, position);
      }}
    >
      <Canvas
        events={(state) => ({ ...canvasEvents(state), filter: prioritizeGizmoHits })}
        shadows
        frameloop="demand"
        camera={{ position: [90, 55, 90], fov: 35, near: 0.1, far: 4000 }}
        onPointerMissed={() => {
          if (!pan && !measure && !saw) selectPart(null);
        }}
        gl={{ antialias: true }}
        onCreated={({ gl, camera, scene: threeScene }) => {
          cameraRef.current = camera;
          glRef.current = gl;
          threeSceneRef.current = threeScene;
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
        {scene ? renderOccurrence(scene.components, null) : null}
        {groupBounds && onChangePoses && !capturing && !pan && !resize && !measure && !saw ? (
          <PartGizmo
            key={`${selectedKeys.join("|")}:${groupBounds.min.join(",")}:${groupBounds.max.join(",")}`}
            pose={{ position: groupDraft ?? ZERO, rotation: ZERO }}
            bounds={groupBounds}
            snapTargets={groupSnapTargets}
            fineSnap={fineSnap}
            disableRotations
            onDragStart={() => setDragActive(true)}
            onDraft={(position) => setGroupDraft(position)}
            onCommit={commitGroup}
          />
        ) : null}
        {componentGroupBounds && onChangeComponentPose && !capturing && !pan && !resize && !measure && !saw ? (
          <PartGizmo
            key={componentSelection.join("|")}
            pose={{ position: groupDraft ?? ZERO, rotation: ZERO }}
            bounds={componentGroupBounds}
            snapTargets={groupSnapTargets}
            fineSnap={fineSnap}
            disableRotations
            onDragStart={() => setDragActive(true)}
            onDraft={(position) => setGroupDraft(position)}
            onCommit={commitComponentGroup}
          />
        ) : null}
        {selectedComponent &&
        selectedComponent.id !== isolatedId &&
        rigidBounds &&
        onChangeComponentPose &&
        !capturing &&
        !pan &&
        !resize &&
        !saw &&
        !measure ? (
          <PartGizmo
            key={`${selectedComponent.id}:${selectedComponent.worldPosition.join(",")}:${selectedComponent.worldRotation.join(",")}`}
            pose={{
              position: componentDraft?.componentId === selectedComponent.id ? componentDraft.position : selectedComponent.worldPosition,
              rotation: componentDraft?.componentId === selectedComponent.id ? componentDraft.rotation : selectedComponent.worldRotation,
            }}
            bounds={rigidBounds}
            snapTargets={groupSnapTargets}
            fineSnap={fineSnap}
            onDragStart={() => setDragActive(true)}
            onDraft={(position, rotation) => setComponentDraft({ componentId: selectedComponent.id, position, rotation })}
            onCommit={(position, rotation) => {
              setDragActive(false);
              setComponentDraft(null);
              const parent = scene ? findSceneParent(scene.components, selectedComponent.id) : null;
              const local = parent
                ? localPoseFromWorld(position, rotation, parent.worldPosition, parent.worldRotation)
                : { position, rotation };
              onChangeComponentPose([{ componentId: selectedComponent.id, position: local.position, rotation: local.rotation }]);
            }}
          />
        ) : null}
        {scene?.fasteners.map((fastener) => (
          <FastenerMesh
            key={fastener.key}
            fastener={fastener}
            highlighted={!capturing && attachedKeys.has(fastener.key)}
            offset={averageOffset(fastener, worldOffsets)}
          />
        ))}
        {scene && !capturing && singleKey && editedPatches.length > 0 ? (
          <ConnectionFaceOverlay
            patches={editedPatches}
            instanceKey={singleKey}
            explodeOffset={worldOffsets.get(singleKey) ?? ZERO}
          />
        ) : null}
        {scene && !capturing && showContacts && singleKey ? (
          <ContactOverlay
            contacts={scene.contacts}
            instanceKey={singleKey}
            explodeOffset={worldOffsets.get(singleKey) ?? ZERO}
            focusedKey={focusedPatch}
            onFocus={setFocusedPatch}
            omitKeys={editedPatchKeys}
            interactive={!pan && !measure && !saw}
          />
        ) : null}
        {measure && scene && !capturing ? (
          <MeasurementOverlay
            corners={measureTargets.corners}
            edges={measureTargets.edges}
            onActiveAxis={setActiveMeasuredAxis}
            onDragActive={setDragActive}
          />
        ) : null}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled={!dragging}
          enableRotate={!saw && !(shiftHeld && !pan && !resize && !measure)}
          // Shift+left pans inside OrbitControls, so both stay off while a marquee can start.
          enablePan={!(shiftHeld && !pan && !resize && !measure)}
          screenSpacePanning
          mouseButtons={{
            LEFT: pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.DOLLY,
          }}
          maxPolarAngle={Math.PI / 2 + (20 * Math.PI) / 180}
        />
        <FitCamera
          bounds={buildBounds}
          resetToken={resetToken}
          focusToken={focusToken}
          controlsRef={controlsRef}
          cameraRef={cameraRef}
        />
        <ExportInvalidate invalidateRef={invalidateRef} />
        {!capturing ? (
          <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
            <GizmoViewport
              axisColors={gimbalAxisColors(measure ? activeMeasuredAxis : null)}
              axisHeadScale={measure && activeMeasuredAxis !== null ? 1.15 : 1}
              labelColor="#d6c3a3"
            />
          </GizmoHelper>
        ) : null}
      </Canvas>
      {marquee ? (
        <div
          className="pointer-events-none absolute z-20 border border-[#f59e0b] bg-[#f59e0b]/25"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      ) : null}
      <RendererToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        explode={explode}
        onExplode={(next) => { setSaw(false); setExplode(next); }}
        saw={saw}
        canSaw={Boolean(selected && getCatalogPart(selected.stockId) && stockGeometry(getCatalogPart(selected.stockId)!) === "box")}
        onSaw={(next) => {
          setSaw(next);
          setResize(false);
          setMeasure(false);
          setPan(false);
          setExplode(0);
          setDragActive(false);
          setDraft(null);
          setGroupDraft(null);
          setComponentDraft(null);
          setResizePreview(null);
        }}
        resize={resize}
        onResize={(next) => {
          setSaw(false);
          setResize(next);
          setPan(false);
          setMeasure(false);
          setDragActive(false);
          setDraft(null);
          setGroupDraft(null);
          setComponentDraft(null);
          setResizePreview(null);
        }}
        measure={measure}
        onMeasure={(next) => {
          setSaw(false);
          setMeasure(next);
          setPan(false);
          setResize(false);
          setDragActive(false);
          setDraft(null);
          setGroupDraft(null);
          setComponentDraft(null);
          setResizePreview(null);
        }}
        showContacts={showContacts}
        onShowContacts={onShowContacts}
        enabled={Boolean(scene)}
      />
      <CameraToolbar
        showUnattached={showUnattached}
        onShowUnattached={onShowUnattached}
        pan={pan}
        canFrame={buildBounds !== null}
        onResetView={() => setResetToken((token) => token + 1)}
        onPan={(next) => {
          setSaw(false);
          setPan(next);
          setResize(false);
          setMeasure(false);
          setDragActive(false);
          setDraft(null);
          setGroupDraft(null);
          setComponentDraft(null);
          setResizePreview(null);
        }}
      />
      {selectedKeys.length > 1 && scene ? (
        <MultiSelectionCard
          instances={sceneMembers(scene.components).filter((part) => selectedMemberKeys.has(part.key))}
        />
      ) : selected ? (
        <SelectionCard
          instance={resizePreview?.key === selected.key ? posed(selected, ZERO) : selected}
          attachedFasteners={attachedFasteners}
          patches={selectedPatches}
          neighbors={neighborLabels}
        />
      ) : null}
      <RenderAlertOverlay alert={alert} />
      {!scene ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[#a89070]">
          Fix the YAML to see the build.
        </div>
      ) : null}
    </div>
  );
}

function FitCamera({
  bounds,
  resetToken,
  focusToken,
  controlsRef,
  cameraRef,
}: {
  bounds: Aabb | null;
  resetToken: number;
  focusToken: number;
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
  cameraRef: RefObject<THREE.Camera | null>;
}) {
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const fitted = useRef(false);
  const appliedToken = useRef(resetToken);
  const appliedFocus = useRef(focusToken);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!bounds || !controls || size.width < 1 || size.height < 1) return;
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (fitted.current && resetToken === appliedToken.current && focusToken === appliedFocus.current) return;

    const aspect = size.width / size.height;
    const frame = frameCamera(bounds, camera.fov, aspect);
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 1e-6) offset.set(90, 55, 90);
    offset.normalize().multiplyScalar(frame.distance);
    controls.target.set(frame.center[0], frame.center[1], frame.center[2]);
    camera.position.copy(controls.target).add(offset);
    camera.near = frame.near;
    camera.far = frame.far;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    controls.update();
    fitted.current = true;
    appliedToken.current = resetToken;
    appliedFocus.current = focusToken;
    invalidate();
  }, [bounds, cameraRef, controlsRef, focusToken, invalidate, resetToken, size.height, size.width]);

  return null;
}

function ExportInvalidate({ invalidateRef }: { invalidateRef: RefObject<(() => void) | null> }) {
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    invalidateRef.current = invalidate;
    return () => {
      invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);
  return null;
}

function renderStills(
  gl: THREE.WebGLRenderer,
  threeScene: THREE.Scene,
  cameras: readonly ExportCamera[],
  bounds: Aabb,
  sizes: readonly { width: number; height: number }[],
): HTMLCanvasElement[] {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 4000);
  const previous = gl.getRenderTarget();
  const shots: HTMLCanvasElement[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    for (let index = 0; index < cameras.length; index += 1) {
      const width = Math.round(sizes[index]!.width);
      const height = Math.round(sizes[index]!.height);
      const aspect = width / height;
      if (!target || target.width !== width || target.height !== height) {
        target?.dispose();
        target = new THREE.WebGLRenderTarget(width, height, {
          samples: 4,
          colorSpace: THREE.SRGBColorSpace,
          type: THREE.UnsignedByteType,
        });
      }
      const pose = resolveExportPose(cameras[index]!, bounds, aspect);
      camera.fov = pose.fov;
      camera.aspect = aspect;
      camera.near = pose.near;
      camera.far = pose.far;
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      gl.setRenderTarget(target);
      gl.render(threeScene, camera);
      const pixels = new Uint8Array(width * height * 4);
      gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      shots.push(flipPixels(pixels, width, height));
    }
    return shots;
  } finally {
    gl.setRenderTarget(previous);
    target?.dispose();
  }
}

function flipPixels(pixels: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(width, height);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * stride;
    image.data.set(pixels.subarray(src, src + stride), y * stride);
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function isTextField(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  if (element.closest(".cm-editor")) return true;
  return element.closest("input, textarea, [contenteditable='true']") !== null;
}
