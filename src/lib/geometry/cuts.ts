import type { Axis, ResolvedCut } from "../schema";
import { clipPolyhedron } from "./clip";
import { boxPolyhedron } from "./solids";
import type { Plane, Polyhedron, Vec3 } from "./types";
import { axisCoord } from "./types";
import { cross, dot, normalize, scale, sub } from "./vec3";

/** Default miter is parallel to the T axis (2), spanning W. When cutting on T, span W (1). */
export function defaultAround(cutAxis: Axis): Axis {
  return cutAxis === 2 ? 1 : 2;
}

export function cutToPlane(cut: ResolvedCut, size: Vec3): Plane {
  const axis = cut.axis;
  const around = cut.around ?? defaultAround(axis);
  const spanAxis = ([0, 1, 2] as Axis[]).find((a) => a !== axis && a !== around);
  if (spanAxis === undefined) {
    throw new Error("`around` must be different from the cut axis");
  }

  const axisXyz = axisCoord(axis);
  const aroundXyz = axisCoord(around);
  const spanXyz = axisCoord(spanAxis);

  const square = Math.abs(cut.angle - 90) < 1e-6 || typeof cut.at === "number";
  if (square) {
    const at = cut.at as number;
    const n: Vec3 = [0, 0, 0];
    n[axisXyz] = 1;
    let d = at;
    if (cut.side === "start") {
      n[axisXyz] = -1;
      d = -at;
    }
    return { normal: n, d };
  }

  const [short, long] = cut.at as [number, number];
  const pShort: Vec3 = [0, 0, 0];
  pShort[axisXyz] = short;
  const pLong: Vec3 = [0, 0, 0];
  pLong[axisXyz] = long;
  pLong[spanXyz] = size[spanAxis];
  const p3: Vec3 = [...pShort];
  p3[aroundXyz] = (size[around] || 1) + 1;

  let n = normalize(cross(sub(pLong, pShort), sub(p3, pShort)));
  if (n[axisXyz] < 0) n = scale(n, -1);
  let d = dot(n, pShort);
  if (cut.side === "start") {
    n = scale(n, -1);
    d = -d;
  }
  return { normal: n, d };
}

export function applyCuts(size: Vec3, cuts: ResolvedCut[]): Polyhedron {
  let poly = boxPolyhedron(size);
  for (const cut of cuts) {
    poly = clipPolyhedron(poly, cutToPlane(cut, size));
  }
  return poly;
}
