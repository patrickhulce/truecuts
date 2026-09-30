import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { compileDocument } from "@/lib/compile";
import { INCHES_TO_METERS, buildExportObject, sceneToGlb } from "./export-scene";

// GLTFExporter reads its binary chunk with FileReader, which browsers provide and Node does not.
if (typeof globalThis.FileReader === "undefined") {
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  }
  globalThis.FileReader = NodeFileReader as unknown as typeof FileReader;
}

const YAML = `version: 1
name: Export Fixture

members:
  - label: Rail
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 32 }
    bores:
      - { face: LxW@1, at: [16, 1.75], diameter: 0.5 }

  - label: Post
    stock: 2x4x8

components:
  - label: Frame
    members:
      - { id: rail-1, position: [0, 0, 0] }
      - { id: post-1, position: [0, 0, 3.5] }
    fasteners:
      - stock: screw-wood-8x2.5
        members:
          - { id: rail-1, at: [4, 1.75, 1.5], direction: [0, 0, 1] }
          - { id: post-1, at: [4, 1.75, 0], direction: [0, 0, -1] }
`;

function compiledScene() {
  const result = compileDocument(YAML);
  expect(result.diagnostics.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(result.scene).toBeDefined();
  return result.scene!;
}

describe("buildExportObject", () => {
  it("scales a cut board from inches to meters", () => {
    const root = buildExportObject(compiledScene());
    root.updateMatrixWorld(true);
    expect(root.scale.x).toBe(INCHES_TO_METERS);
    expect(root.userData).toEqual({ sourceUnits: "inches", units: "meters" });

    const rail = root.getObjectByName("Rail");
    expect(rail).toBeInstanceOf(THREE.Mesh);
    const mesh = rail as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    expect(box.max.x - box.min.x).toBeCloseTo(32 * INCHES_TO_METERS, 4);

    const index = mesh.geometry.getIndex();
    const triangles = index ? index.count / 3 : mesh.geometry.getAttribute("position").count / 3;
    expect(triangles).toBeGreaterThan(12);
    dispose(root);
  });
});

describe("sceneToGlb", () => {
  it("writes a binary glTF that names the board and the screw", async () => {
    const glb = await sceneToGlb(compiledScene());
    expect(new TextDecoder().decode(new Uint8Array(glb, 0, 4))).toBe("glTF");
    const jsonLength = new DataView(glb).getUint32(12, true);
    const json = new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength));
    expect(json).toContain("Rail");
    expect(json).toContain("wood screw");
  });
});

function dispose(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  });
}
