import { describe, expect, it } from "vitest";
import { frameCamera } from "./camera-frame";
import {
  EXPORT_FIT_FOV,
  anglesFromOffset,
  defaultExportCameras,
  exportDirection,
  orbitPreviewOffset,
  readExportCameras,
  resolveExportPose,
  snapshotExportCamera,
  writeExportCameras,
  type ExportCamera,
} from "./export-view";
import type { Aabb, Vec3 } from "./geometry";

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Aabb {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function distance(position: Vec3, target: Vec3): number {
  return Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
}

function direction(position: Vec3, target: Vec3): Vec3 {
  const length = distance(position, target);
  return [
    (position[0] - target[0]) / length,
    (position[1] - target[1]) / length,
    (position[2] - target[2]) / length,
  ];
}

const BOUNDS = box(0, 0, 0, 48, 36, 24);

describe("default export cameras", () => {
  it("places the five sheet views", () => {
    expect(
      defaultExportCameras().map((camera) => [camera.name, camera.azimuthDeg, camera.elevationDeg, camera.fov]),
    ).toEqual([
      ["Perspective", 45, 20, null],
      ["Secondary", 135, 20, null],
      ["Top", 0, 90, null],
      ["Front", 90, 0, null],
      ["Side", 0, 0, null],
    ]);
  });

  it("aims each default along its axis", () => {
    const [az45, az135, top, posX, sideZ] = defaultExportCameras().map((camera) =>
      resolveExportPose(camera, BOUNDS, 4 / 3),
    );
    const elevation = (20 * Math.PI) / 180;
    const horizontal = Math.cos(elevation);
    expect(direction(az45!.position, az45!.target)).toEqual([
      expect.closeTo(horizontal * Math.sin(Math.PI / 4), 5),
      expect.closeTo(Math.sin(elevation), 5),
      expect.closeTo(horizontal * Math.cos(Math.PI / 4), 5),
    ]);
    expect(direction(az135!.position, az135!.target)).toEqual([
      expect.closeTo(horizontal * Math.sin((3 * Math.PI) / 4), 5),
      expect.closeTo(Math.sin(elevation), 5),
      expect.closeTo(horizontal * Math.cos((3 * Math.PI) / 4), 5),
    ]);
    expect(direction(top!.position, top!.target)).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(1, 5),
      expect.closeTo(0, 5),
    ]);
    expect(top!.up).toEqual([expect.closeTo(0, 5), expect.closeTo(0, 5), expect.closeTo(-1, 5)]);
    expect(direction(posX!.position, posX!.target)).toEqual([
      expect.closeTo(1, 5),
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
    ]);
    expect(posX!.up).toEqual([0, 1, 0]);
    expect(direction(sideZ!.position, sideZ!.target)).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
      expect.closeTo(1, 5),
    ]);
  });
});

describe("resolveExportPose", () => {
  it("fits through the sheet lens instead of a viewport fov", () => {
    const pose = resolveExportPose(defaultExportCameras()[0]!, BOUNDS, 4 / 3);
    const fitted = frameCamera(BOUNDS, EXPORT_FIT_FOV, 4 / 3);
    const viewportLens = frameCamera(BOUNDS, 70, 4 / 3);
    expect(pose.fov).toBe(EXPORT_FIT_FOV);
    expect(pose.target).toEqual(fitted.center);
    expect(distance(pose.position, pose.target)).toBeCloseTo(fitted.distance, 5);
    expect(distance(pose.position, pose.target)).not.toBeCloseTo(viewportLens.distance, 1);
  });

  it("re-solves distance when the fov is set by hand", () => {
    const camera = defaultExportCameras()[0]!;
    const wide = resolveExportPose({ ...camera, fov: 60 }, BOUNDS, 4 / 3);
    const tight = resolveExportPose({ ...camera, fov: 20 }, BOUNDS, 4 / 3);
    expect(wide.fov).toBe(60);
    expect(distance(wide.position, wide.target)).toBeCloseTo(frameCamera(BOUNDS, 60, 4 / 3).distance, 5);
    expect(distance(tight.position, tight.target)).toBeCloseTo(frameCamera(BOUNDS, 20, 4 / 3).distance, 5);
    expect(distance(tight.position, tight.target)).toBeGreaterThan(distance(wide.position, wide.target));
  });

  it("keeps a pinned snapshot when the build changes size", () => {
    const camera = snapshotExportCamera(defaultExportCameras()[0]!, {
      position: [10, 20, 30],
      target: [1, 2, 3],
      fov: 42,
    });
    const small = resolveExportPose(camera, box(0, 0, 0, 1, 1, 1), 1);
    const large = resolveExportPose(camera, box(0, 0, 0, 200, 80, 40), 2);
    expect(distance(small.position, small.target)).toBeCloseTo(distance(large.position, large.target), 5);
    expect(small.fov).toBe(42);
    expect(large.target).toEqual([1, 2, 3]);
  });
});

describe("snapshotExportCamera", () => {
  it("round-trips azimuth, elevation, distance, target, and fov", () => {
    const azimuthDeg = 135;
    const elevationDeg = 25;
    const length = 80;
    const target: Vec3 = [10, 20, 30];
    const offset = exportDirection(azimuthDeg, elevationDeg).map((coord) => coord * length) as Vec3;
    const next = snapshotExportCamera(defaultExportCameras()[3]!, {
      position: [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]],
      target,
      fov: 42,
    });
    expect(next.id).toBe("pos-x");
    expect(next.name).toBe("Front");
    expect(next.azimuthDeg).toBeCloseTo(azimuthDeg, 5);
    expect(next.elevationDeg).toBeCloseTo(elevationDeg, 5);
    expect(next.fov).toBe(42);
    expect(next.pinned).toEqual({ target, distance: length });

    const pose = resolveExportPose(next, BOUNDS, 1.5);
    expect(pose.fov).toBe(42);
    expect(pose.target).toEqual(target);
    expect(distance(pose.position, pose.target)).toBeCloseTo(length, 5);
    expect(anglesFromOffset([
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    ]).azimuthDeg).toBeCloseTo(azimuthDeg, 5);
  });

  it("keeps azimuth when a top-view preview sits a hair off the pole", () => {
    const offset = orbitPreviewOffset(90, 90, 50);
    const next = snapshotExportCamera(defaultExportCameras()[2]!, {
      position: offset,
      target: [0, 0, 0],
      fov: 28,
    });
    expect(next.azimuthDeg).toBeCloseTo(90, 4);
    expect(next.elevationDeg).toBe(90);
    expect(next.fov).toBe(28);
    expect(next.pinned?.distance).toBeCloseTo(50, 4);
  });
});

describe("readExportCameras", () => {
  it("falls back when the stored value is missing or corrupt", () => {
    expect(readExportCameras(null).map((camera) => camera.id)).toEqual(defaultExportCameras().map((camera) => camera.id));
    expect(readExportCameras("nope").map((camera) => camera.id)).toEqual(["az-45", "az-135", "top", "pos-x", "side-z"]);
    expect(readExportCameras(JSON.stringify({ version: 2, cameras: [] })).map((camera) => camera.id)).toEqual([
      "az-45",
      "az-135",
      "top",
      "pos-x",
      "side-z",
    ]);
  });

  it("keeps an explicit empty list and clamps a saved camera", () => {
    expect(readExportCameras(writeExportCameras([]))).toEqual([]);
    const saved: ExportCamera = {
      id: "custom",
      name: "  Corner  ",
      azimuthDeg: 400,
      elevationDeg: 200,
      fov: 999,
      pinned: { target: [1, 2, 3], distance: 40 },
    };
    expect(readExportCameras(writeExportCameras([saved]))).toEqual([
      {
        id: "custom",
        name: "Corner",
        azimuthDeg: 40,
        elevationDeg: 90,
        fov: 120,
        pinned: { target: [1, 2, 3], distance: 40 },
      },
    ]);
  });

  it("drops a pin when the camera is still in Fit", () => {
    const raw = JSON.stringify({
      version: 1,
      cameras: [
        {
          id: "fit",
          name: "Fit",
          azimuthDeg: 10,
          elevationDeg: 20,
          fov: null,
          pinned: { target: [0, 0, 0], distance: 10 },
        },
      ],
    });
    expect(readExportCameras(raw)[0]?.pinned).toBeNull();
  });
});
