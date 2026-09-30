import { clipForDistance, frameCamera } from "./camera-frame";
import type { Aabb, Vec3 } from "./geometry";

/** Sheet-local lens used while a camera is in Fit. Not read from the orbit camera. */
export const EXPORT_FIT_FOV = 35;
export const EXPORT_FOV_MIN = 5;
export const EXPORT_FOV_MAX = 120;
export const EXPORT_ELEVATION_MIN = -20;
export const EXPORT_ELEVATION_MAX = 90;
export const EXPORT_CAMERAS_KEY = "truecuts.export-cameras";

const MIN_DISTANCE = 0.05;
/** Snap a hair under the pole back to a true top view after OrbitControls nudges it. */
const POLE_SNAP = 89.95;

export type ExportPinned = {
  target: Vec3;
  distance: number;
};

/**
 * A still on the sheet. `fov: null` is Fit: distance is solved so the build fills
 * the frame. A number is that vertical fov in degrees. `pinned` is set by Use
 * current and keeps the orbit target and distance until Fit or a fov edit.
 */
export type ExportCamera = {
  id: string;
  name: string;
  /** Degrees around Y. 0 looks from +Z, 90 from +X, 180 from −Z. */
  azimuthDeg: number;
  /** Degrees above the horizon. 90 is straight down from above. */
  elevationDeg: number;
  fov: number | null;
  pinned: ExportPinned | null;
};

export type OrbitSnapshot = {
  position: Vec3;
  target: Vec3;
  fov: number;
};

export type ResolvedExportPose = {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;
};

export type ViewportExportApi = {
  readOrbit: () => OrbitSnapshot | null;
  preview: (camera: ExportCamera, bounds: Aabb) => void;
  capture: (
    cameras: readonly ExportCamera[],
    bounds: Aabb,
    sizes: readonly { width: number; height: number }[],
  ) => Promise<HTMLCanvasElement[]>;
};

const DEFAULTS: readonly ExportCamera[] = [
  { id: "az-45", name: "Perspective", azimuthDeg: 45, elevationDeg: 20, fov: null, pinned: null },
  { id: "az-135", name: "Secondary", azimuthDeg: 135, elevationDeg: 20, fov: null, pinned: null },
  { id: "top", name: "Top", azimuthDeg: 0, elevationDeg: 90, fov: null, pinned: null },
  { id: "pos-x", name: "Front", azimuthDeg: 90, elevationDeg: 0, fov: null, pinned: null },
  { id: "side-z", name: "Side", azimuthDeg: 0, elevationDeg: 0, fov: null, pinned: null },
];

export function defaultExportCameras(): ExportCamera[] {
  return DEFAULTS.map((camera) => ({ ...camera, pinned: null }));
}

export function normalizeAzimuth(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped === 0 ? 0 : wrapped;
}

export function clampElevation(deg: number): number {
  return Math.min(EXPORT_ELEVATION_MAX, Math.max(EXPORT_ELEVATION_MIN, deg));
}

export function clampFov(deg: number): number {
  return Math.min(EXPORT_FOV_MAX, Math.max(EXPORT_FOV_MIN, deg));
}

/** Unit offset from the look-at point to the camera. */
export function exportDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const elevation = (elevationDeg * Math.PI) / 180;
  return [
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ];
}

/**
 * Camera up. At the pole, image up points toward −Z when azimuth is 0, so world
 * +X is to the right. Elsewhere up is world +Y.
 */
export function exportUp(azimuthDeg: number, elevationDeg: number): Vec3 {
  if (elevationDeg >= EXPORT_ELEVATION_MAX - 1e-3) {
    const azimuth = (azimuthDeg * Math.PI) / 180;
    return [-Math.sin(azimuth), 0, -Math.cos(azimuth)];
  }
  return [0, 1, 0];
}

export function anglesFromOffset(offset: Vec3): { azimuthDeg: number; elevationDeg: number; distance: number } {
  const distance = Math.hypot(offset[0], offset[1], offset[2]);
  if (distance < 1e-8) {
    return { azimuthDeg: 0, elevationDeg: 0, distance: MIN_DISTANCE };
  }
  const elevationDeg = (Math.asin(Math.min(1, Math.max(-1, offset[1] / distance))) * 180) / Math.PI;
  let azimuthDeg = (Math.atan2(offset[0], offset[2]) * 180) / Math.PI;
  if (azimuthDeg < 0) azimuthDeg += 360;
  return { azimuthDeg, elevationDeg, distance };
}

/**
 * Position OrbitControls can digest. Exactly on the pole, theta is lost, so a
 * top view sits a hair off the axis along its azimuth.
 */
export function orbitPreviewOffset(azimuthDeg: number, elevationDeg: number, distance: number): Vec3 {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const pole = 1e-4;
  let phi = ((90 - elevationDeg) * Math.PI) / 180;
  phi = Math.min(Math.PI - pole, Math.max(pole, phi));
  return [
    distance * Math.sin(phi) * Math.sin(azimuth),
    distance * Math.cos(phi),
    distance * Math.sin(phi) * Math.cos(azimuth),
  ];
}

export function resolveExportPose(camera: ExportCamera, bounds: Aabb, aspect: number): ResolvedExportPose {
  const direction = exportDirection(camera.azimuthDeg, camera.elevationDeg);
  const up = exportUp(camera.azimuthDeg, camera.elevationDeg);
  if (camera.pinned && camera.fov !== null) {
    const distance = camera.pinned.distance;
    const target = camera.pinned.target;
    const clip = clipForDistance(distance);
    return {
      position: [
        target[0] + direction[0] * distance,
        target[1] + direction[1] * distance,
        target[2] + direction[2] * distance,
      ],
      target,
      up,
      fov: camera.fov,
      near: clip.near,
      far: clip.far,
    };
  }
  const fov = camera.fov ?? EXPORT_FIT_FOV;
  const frame = frameCamera(bounds, fov, aspect);
  return {
    position: [
      frame.center[0] + direction[0] * frame.distance,
      frame.center[1] + direction[1] * frame.distance,
      frame.center[2] + direction[2] * frame.distance,
    ],
    target: frame.center,
    up,
    fov,
    near: frame.near,
    far: frame.far,
  };
}

export function snapshotExportCamera(camera: ExportCamera, orbit: OrbitSnapshot): ExportCamera {
  const angles = anglesFromOffset([
    orbit.position[0] - orbit.target[0],
    orbit.position[1] - orbit.target[1],
    orbit.position[2] - orbit.target[2],
  ]);
  const fov = clampFov(orbit.fov);
  const elevationDeg = angles.elevationDeg > POLE_SNAP ? EXPORT_ELEVATION_MAX : clampElevation(angles.elevationDeg);
  return {
    id: camera.id,
    name: camera.name,
    azimuthDeg: normalizeAzimuth(angles.azimuthDeg),
    elevationDeg,
    fov,
    pinned: {
      target: [orbit.target[0], orbit.target[1], orbit.target[2]],
      distance: Math.max(angles.distance, MIN_DISTANCE),
    },
  };
}

export function nextExportCamera(existing: readonly ExportCamera[]): ExportCamera {
  let index = existing.length + 1;
  let id = `view-${index}`;
  const taken = new Set(existing.map((camera) => camera.id));
  while (taken.has(id)) {
    index += 1;
    id = `view-${index}`;
  }
  return {
    id,
    name: `View ${index}`,
    azimuthDeg: 0,
    elevationDeg: 0,
    fov: null,
    pinned: null,
  };
}

export function writeExportCameras(cameras: readonly ExportCamera[]): string {
  return JSON.stringify({ version: 1, cameras });
}

export function readExportCameras(raw: string | null): ExportCamera[] {
  if (!raw) return defaultExportCameras();
  try {
    const data = JSON.parse(raw) as { version?: unknown; cameras?: unknown };
    if (!data || data.version !== 1 || !Array.isArray(data.cameras)) return defaultExportCameras();
    const cameras = data.cameras.flatMap(parseCamera);
    if (cameras.length === 0 && data.cameras.length > 0) return defaultExportCameras();
    return cameras;
  } catch {
    return defaultExportCameras();
  }
}

function parseCamera(value: unknown): ExportCamera[] {
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  if (typeof data.id !== "string" || data.id.length === 0) return [];
  if (typeof data.name !== "string" || data.name.trim().length === 0) return [];
  if (typeof data.azimuthDeg !== "number" || !Number.isFinite(data.azimuthDeg)) return [];
  if (typeof data.elevationDeg !== "number" || !Number.isFinite(data.elevationDeg)) return [];
  const fov = parseFov(data.fov);
  if (fov === undefined) return [];
  const pinned = parsePinned(data.pinned);
  if (pinned === undefined) return [];
  return [
    {
      id: data.id,
      name: data.name.trim().slice(0, 80),
      azimuthDeg: normalizeAzimuth(data.azimuthDeg),
      elevationDeg: clampElevation(data.elevationDeg),
      fov,
      pinned: fov === null ? null : pinned,
    },
  ];
}

function parseFov(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clampFov(value);
}

function parsePinned(value: unknown): ExportPinned | null | undefined {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.target) || data.target.length !== 3) return undefined;
  if (!data.target.every((coord) => typeof coord === "number" && Number.isFinite(coord))) return undefined;
  if (typeof data.distance !== "number" || !Number.isFinite(data.distance) || data.distance <= 0) return undefined;
  return {
    target: [data.target[0], data.target[1], data.target[2]],
    distance: data.distance,
  };
}
