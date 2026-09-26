"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { CatalogPart } from "@/lib/catalog";
import { catalogMemberInstance } from "@/lib/catalog-preview";
import { facesToGeometry } from "@/lib/mesh/subtract-holes";
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

const PREVIEW_PX = 128;
const previewUrls = new Map<string, string>();
let previewRenderer: THREE.WebGLRenderer | null = null;
let previewChain: Promise<void> = Promise.resolve();

function previewRendererInstance(): THREE.WebGLRenderer {
  if (!previewRenderer) {
    previewRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    previewRenderer.setPixelRatio(1);
    previewRenderer.setSize(PREVIEW_PX, PREVIEW_PX, false);
    previewRenderer.setClearColor("#140e09");
  }
  return previewRenderer;
}

/** Square framing. Very long stock is cropped so the cross-section stays visible. */
function previewFrame(bounds: { min: [number, number, number]; max: [number, number, number] }): {
  focus: THREE.Vector3;
  extent: number;
} {
  const dims = [0, 1, 2].map((axis) => Math.max(bounds.max[axis] - bounds.min[axis], 0.05));
  const longest = Math.max(...dims);
  const mid = [...dims].sort((a, b) => b - a)[1] ?? longest;
  const extent = longest / Math.max(mid, 0.05) > 4 ? mid * 3.5 : longest;
  const focus = new THREE.Vector3(
    bounds.min[0] + Math.min(dims[0] * 0.5, extent * 0.45),
    bounds.min[1] + Math.min(dims[1] * 0.5, extent * 0.45),
    bounds.min[2] + Math.min(dims[2] * 0.5, extent * 0.45),
  );
  return { focus, extent: Math.max(extent, 0.5) };
}

function drawCatalogPreview(instance: SceneMemberInstance): string {
  const renderer = previewRendererInstance();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#140e09");
  scene.add(new THREE.AmbientLight("#ffffff", 0.75));
  const directional = new THREE.DirectionalLight("#ffffff", 1.15);
  directional.position.set(4, 6, 3);
  scene.add(directional);

  const geometry = facesToGeometry(instance.faces);
  const material = new THREE.MeshStandardMaterial({
    color: instance.color,
    roughness: 0.55,
    metalness: 0.04,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 20),
    new THREE.LineBasicMaterial({ color: "#3b2410" }),
  );
  scene.add(mesh, edges);

  const { focus, extent } = previewFrame({
    min: instance.bounds.min,
    max: instance.bounds.max,
  });
  const camera = new THREE.OrthographicCamera(
    -PREVIEW_PX / 2,
    PREVIEW_PX / 2,
    PREVIEW_PX / 2,
    -PREVIEW_PX / 2,
    0.01,
    Math.max(instance.bounds.max[0], instance.bounds.max[1], instance.bounds.max[2], extent) * 20,
  );
  camera.position.set(focus.x + extent, focus.y + extent * 0.85, focus.z + extent);
  camera.lookAt(focus);
  camera.zoom = (PREVIEW_PX * 0.72) / extent;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  const url = renderer.domElement.toDataURL("image/png");
  geometry.dispose();
  material.dispose();
  edges.geometry.dispose();
  const edgeMaterial = edges.material;
  if (edgeMaterial instanceof THREE.Material) edgeMaterial.dispose();
  return url;
}

function renderCatalogPreview(key: string, instance: SceneMemberInstance): Promise<string> {
  const cached = previewUrls.get(key);
  if (cached) return Promise.resolve(cached);
  const result = previewChain.then(() => {
    const hit = previewUrls.get(key);
    if (hit) return hit;
    const url = drawCatalogPreview(instance);
    previewUrls.set(key, url);
    return url;
  });
  previewChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function CatalogThumbnail({
  part,
  size,
  cutAt,
}: {
  part: CatalogPart;
  size?: number[];
  cutAt?: number;
}) {
  const sizeKey = size?.join(",") ?? "";
  const instance = useMemo(() => {
    try {
      return catalogMemberInstance(part, { size, cutAt });
    } catch {
      return null;
    }
  }, [cutAt, part, size]);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!instance) return;
    let cancelled = false;
    const key = `${part.id}|${sizeKey}|${cutAt ?? ""}`;
    void renderCatalogPreview(key, instance)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cutAt, instance, part.id, sizeKey]);

  return (
    <div className="pointer-events-none h-16 w-16 shrink-0 overflow-hidden rounded border border-[#3d2a18] bg-[#140e09]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated WebGL snapshot, not a remote asset
        <img alt="" src={url} className="h-full w-full" draggable={false} />
      ) : (
        <span className="block h-full w-full" style={{ background: part.color }} />
      )}
    </div>
  );
}
