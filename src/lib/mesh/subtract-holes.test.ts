import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { placeHole } from "@/lib/geometry/faces";
import { boxPolyhedron } from "@/lib/geometry/solids";
import type { Vec3 } from "@/lib/geometry";
import { facesToGeometry, subtractHoles } from "./subtract-holes";

const SIZE: Vec3 = [10, 4, 2];

function hitsAlongBore(depth?: number): THREE.Intersection[] {
  const hole = placeHole({ face: "LxW@1", at: [5, 2], diameter: 1, depth }, SIZE);
  const solid = facesToGeometry(boxPolyhedron(SIZE));
  const cut = subtractHoles(solid, [hole]);
  expect(cut).not.toBeNull();
  const mesh = new THREE.Mesh(cut!);
  const ray = new THREE.Raycaster(new THREE.Vector3(5, 4, 2), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(mesh);
  solid.dispose();
  cut!.dispose();
  return hits;
}

describe("subtractHoles", () => {
  it("stops a blind hole at its depth", () => {
    const hits = hitsAlongBore(0.5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.y).toBeCloseTo(1.5, 2);
  });

  it("opens a through hole along the bore", () => {
    expect(hitsAlongBore().length).toBe(0);
  });

  it("leaves the rest of the face in place", () => {
    const hole = placeHole({ face: "LxW@1", at: [5, 2], diameter: 1, depth: 0.5 }, SIZE);
    const solid = facesToGeometry(boxPolyhedron(SIZE));
    const cut = subtractHoles(solid, [hole]);
    const mesh = new THREE.Mesh(cut!);
    const ray = new THREE.Raycaster(new THREE.Vector3(1, 4, 1), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(mesh);
    expect(hits[0].point.y).toBeCloseTo(2, 2);
    solid.dispose();
    cut!.dispose();
  });
});
