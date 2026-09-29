import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { placeBore } from "@/lib/geometry/faces";
import { boxPolyhedron } from "@/lib/geometry/solids";
import type { Vec3 } from "@/lib/geometry";
import { drilledMemberGeometry, facesToGeometry, subtractBores } from "./subtract-holes";

const SIZE: Vec3 = [10, 4, 2];

function hitsAlongBore(depth?: number): THREE.Intersection[] {
  const hole = placeBore({ face: "LxW@1", at: [5, 2], diameter: 1, depth }, SIZE);
  const solid = facesToGeometry(boxPolyhedron(SIZE));
  const cut = subtractBores(solid, [hole]);
  expect(cut).not.toBeNull();
  const mesh = new THREE.Mesh(cut!);
  const ray = new THREE.Raycaster(new THREE.Vector3(5, 4, 2), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(mesh);
  solid.dispose();
  cut!.dispose();
  return hits;
}

describe("subtractBores", () => {
  it("stops a blind hole at its depth", () => {
    const hits = hitsAlongBore(0.5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.y).toBeCloseTo(1.5, 2);
  });

  it("opens a through hole along the bore", () => {
    expect(hitsAlongBore().length).toBe(0);
  });

  it("leaves the rest of the face in place", () => {
    const hole = placeBore({ face: "LxW@1", at: [5, 2], diameter: 1, depth: 0.5 }, SIZE);
    const solid = facesToGeometry(boxPolyhedron(SIZE));
    const cut = subtractBores(solid, [hole]);
    const mesh = new THREE.Mesh(cut!);
    const ray = new THREE.Raycaster(new THREE.Vector3(1, 4, 1), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(mesh);
    expect(hits[0].point.y).toBeCloseTo(2, 2);
    solid.dispose();
    cut!.dispose();
  });

  it("opens two holes in one subtraction", () => {
    const holes = [3, 7].map((at) => placeBore({ face: "LxW@1", at: [at, 2], diameter: 1 }, SIZE));
    const solid = facesToGeometry(boxPolyhedron(SIZE));
    const cut = subtractBores(solid, holes);
    expect(cut).not.toBeNull();
    const mesh = new THREE.Mesh(cut!);
    for (const at of [3, 7]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(at, 4, 2), new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh)).toHaveLength(0);
    }
    const between = new THREE.Raycaster(new THREE.Vector3(5, 4, 1), new THREE.Vector3(0, -1, 0));
    const hits = between.intersectObject(mesh);
    expect(hits[0].point.y).toBeCloseTo(2, 2);
    solid.dispose();
    cut!.dispose();
  });
});

describe("drilledMemberGeometry", () => {
  it("returns a clone so disposing one mesh keeps the cached cut", () => {
    const hole = placeBore({ face: "LxW@1", at: [5, 2], diameter: 1, depth: 0.5 }, SIZE);
    const faces = boxPolyhedron(SIZE);
    const first = drilledMemberGeometry(faces, [hole]);
    const second = drilledMemberGeometry(faces, [hole]);
    expect(first.cut).toBe(true);
    expect(second.cut).toBe(true);
    expect(first.geometry).not.toBe(second.geometry);
    const count = second.geometry.getAttribute("position").count;
    first.geometry.dispose();
    expect(second.geometry.getAttribute("position").count).toBe(count);
    second.geometry.dispose();
  });
});
