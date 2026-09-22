import type { Face, Vec3 } from "./types";
import { axisCoord } from "./types";

/** Six stock-box faces. `@0` is the origin plane; `@1` is the stock extent of the other axis. */
export const FACE_IDS = ["LxW@0", "LxW@1", "LxT@0", "LxT@1", "WxT@0", "WxT@1"] as const;

export type FaceId = (typeof FACE_IDS)[number];

/** Box quad order. Matches the historical `boxPolyhedron` winding. */
export const BOX_FACE_ORDER: readonly FaceId[] = FACE_IDS;

type AxisIndex = 0 | 1 | 2;

const AXIS_LETTER = ["L", "W", "T"] as const;

type FaceSpec = {
  axes: [AxisIndex, AxisIndex];
  normalAxis: AxisIndex;
  side: 0 | 1;
};

const FACE_SPEC: Record<FaceId, FaceSpec> = {
  "LxW@0": { axes: [0, 1], normalAxis: 2, side: 0 },
  "LxW@1": { axes: [0, 1], normalAxis: 2, side: 1 },
  "LxT@0": { axes: [0, 2], normalAxis: 1, side: 0 },
  "LxT@1": { axes: [0, 2], normalAxis: 1, side: 1 },
  "WxT@0": { axes: [1, 2], normalAxis: 0, side: 0 },
  "WxT@1": { axes: [1, 2], normalAxis: 0, side: 1 },
};

export type FaceFrame = {
  id: FaceId;
  /** Axis not named in the id: 0 = L, 1 = W, 2 = T. */
  normalAxis: AxisIndex;
  side: 0 | 1;
  /** In-plane axes in the order written in the id. */
  axes: [AxisIndex, AxisIndex];
  /** Outward unit normal in part-local XYZ. */
  normal: Vec3;
  /** Coordinate of the plane along `normalAxis` (0, or the stock extent). */
  plane: number;
};

export type PlacedHole = {
  face: FaceId;
  at: [number, number];
  diameter: number;
  /** Bore length inward from the face. Equals the stock extent when `through`. */
  depth: number;
  /** True when the bore reaches the opposite stock plane. */
  through: boolean;
  center: Vec3;
  normal: Vec3;
};

const FIT_EPS = 1e-6;

export function isFaceId(value: string): value is FaceId {
  return (FACE_IDS as readonly string[]).includes(value);
}

export function parseFaceId(value: string): FaceId {
  if (isFaceId(value)) return value;
  throw new Error(`Unknown face "${value}". Expected one of ${FACE_IDS.join(", ")}.`);
}

export function faceFrame(id: FaceId, size: Vec3): FaceFrame {
  const spec = FACE_SPEC[id];
  const plane = spec.side === 0 ? 0 : size[spec.normalAxis];
  const normal: Vec3 = [0, 0, 0];
  normal[axisCoord(spec.normalAxis)] = spec.side === 0 ? -1 : 1;
  return {
    id,
    normalAxis: spec.normalAxis,
    side: spec.side,
    axes: spec.axes,
    normal,
    plane,
  };
}

/** Part-local point for an in-plane position. `at` follows the axis order in the face id. */
export function pointOnFace(id: FaceId, size: Vec3, at: [number, number]): Vec3 {
  const frame = faceFrame(id, size);
  const point: Vec3 = [0, 0, 0];
  point[axisCoord(frame.axes[0])] = at[0];
  point[axisCoord(frame.axes[1])] = at[1];
  point[axisCoord(frame.normalAxis)] = frame.plane;
  return point;
}

/** Outward-wound stock quad for `id`. */
export function faceQuad(id: FaceId, size: Vec3): Face {
  const [l, w, t] = size;
  switch (id) {
    case "LxW@0":
      return [
        [0, 0, 0],
        [l, 0, 0],
        [l, 0, w],
        [0, 0, w],
      ];
    case "LxW@1":
      return [
        [0, t, 0],
        [0, t, w],
        [l, t, w],
        [l, t, 0],
      ];
    case "LxT@0":
      return [
        [0, 0, 0],
        [0, t, 0],
        [l, t, 0],
        [l, 0, 0],
      ];
    case "LxT@1":
      return [
        [0, 0, w],
        [l, 0, w],
        [l, t, w],
        [0, t, w],
      ];
    case "WxT@0":
      return [
        [0, 0, 0],
        [0, 0, w],
        [0, t, w],
        [0, t, 0],
      ];
    case "WxT@1":
      return [
        [l, 0, 0],
        [l, t, 0],
        [l, t, w],
        [l, 0, w],
      ];
  }
}

/**
 * Place a drilled hole on a stock face.
 * The circle must lie inside the stock rectangle. Omit `depth` to bore through the stock.
 * The hole is not cut from the solid.
 */
export function placeHole(
  hole: { face: FaceId; at: [number, number]; diameter: number; depth?: number },
  size: Vec3,
): PlacedHole {
  if (!(hole.diameter > 0)) {
    throw new Error("Hole diameter must be greater than 0");
  }

  const frame = faceFrame(hole.face, size);
  const stockDepth = size[frame.normalAxis];
  const depth = hole.depth ?? stockDepth;
  if (!(depth > 0)) {
    throw new Error("Hole depth must be greater than 0");
  }
  if (depth > stockDepth + FIT_EPS) {
    throw new Error(
      `Hole depth ${depth} on ${hole.face} is deeper than the stock (${AXIS_LETTER[frame.normalAxis]} ${stockDepth})`,
    );
  }
  for (let i = 0; i < 2; i++) {
    const axis = frame.axes[i];
    const value = hole.at[i];
    const extent = size[axis];
    if (value < -FIT_EPS || value > extent + FIT_EPS) {
      throw new Error(
        `Hole center on ${hole.face} is outside the stock face (${AXIS_LETTER[axis]} ${value} is outside 0–${extent})`,
      );
    }
  }

  const radius = hole.diameter / 2;
  for (let i = 0; i < 2; i++) {
    const axis = frame.axes[i];
    const value = hole.at[i];
    const extent = size[axis];
    if (value - radius < -FIT_EPS || value + radius > extent + FIT_EPS) {
      throw new Error(`Hole on ${hole.face} extends past the stock face`);
    }
  }

  return {
    face: hole.face,
    at: [hole.at[0], hole.at[1]],
    diameter: hole.diameter,
    depth,
    through: depth >= stockDepth - FIT_EPS,
    center: pointOnFace(hole.face, size, hole.at),
    normal: frame.normal,
  };
}
