import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { placeBore } from "@/lib/geometry/faces";
import { boxPolyhedron } from "@/lib/geometry/solids";
import type { Vec3 } from "@/lib/geometry";
import { memberEdgeGeometry } from "./part-edges";

const SIZE: Vec3 = [10, 4, 2];
const FACE_Y = 2;

function onRectangleSide(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const near = (value: number, target: number) => Math.abs(value - target) < 1e-3;
  return (
    (near(a.z, 0) && near(b.z, 0)) ||
    (near(a.z, SIZE[1]) && near(b.z, SIZE[1])) ||
    (near(a.x, 0) && near(b.x, 0)) ||
    (near(a.x, SIZE[0]) && near(b.x, SIZE[0]))
  );
}

describe("memberEdgeGeometry", () => {
  it("keeps a holed face free of spokes", () => {
    const hole = placeBore({ face: "LxW@1", at: [5, 2], diameter: 1, depth: 0.5 }, SIZE);
    const geometry = memberEdgeGeometry(boxPolyhedron(SIZE), [hole]);
    const position = geometry.getAttribute("position");
    const center = new THREE.Vector3(hole.center[0], hole.center[1], hole.center[2]);
    let sides = 0;
    let chords = 0;

    for (let i = 0; i < position.count; i += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i);
      const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
      if (Math.abs(a.y - FACE_Y) > 1e-3 || Math.abs(b.y - FACE_Y) > 1e-3) continue;

      const side = onRectangleSide(a, b);
      const chord =
        a.distanceTo(b) < hole.diameter &&
        a.distanceTo(center) < hole.diameter &&
        b.distanceTo(center) < hole.diameter;
      expect(side || chord).toBe(true);
      if (side) sides += 1;
      if (chord) chords += 1;
    }

    expect(sides).toBeGreaterThan(0);
    expect(chords).toBe(16);
    geometry.dispose();
  });
});
