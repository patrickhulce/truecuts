import { describe, expect, it } from "vitest";
import { faceNormal } from "./solids";
import {
  FACE_IDS,
  faceFrame,
  faceQuad,
  parseFaceId,
  placeBore,
  pointOnFace,
  type FaceId,
} from "./faces";
import type { Vec3 } from "./types";

const SIZE: Vec3 = [10, 4, 2];

const EXPECTED: Record<
  FaceId,
  { plane: number; normal: Vec3; at: [number, number]; point: Vec3 }
> = {
  "LxW@0": { plane: 0, normal: [0, -1, 0], at: [3, 1], point: [3, 0, 1] },
  "LxW@1": { plane: 2, normal: [0, 1, 0], at: [3, 1], point: [3, 2, 1] },
  "LxT@0": { plane: 0, normal: [0, 0, -1], at: [3, 1], point: [3, 1, 0] },
  "LxT@1": { plane: 4, normal: [0, 0, 1], at: [3, 1], point: [3, 1, 4] },
  "WxT@0": { plane: 0, normal: [-1, 0, 0], at: [1, 0.5], point: [0, 0.5, 1] },
  "WxT@1": { plane: 10, normal: [1, 0, 0], at: [1, 0.5], point: [10, 0.5, 1] },
};

describe("face frames", () => {
  it.each(FACE_IDS)("%s sits on its stock plane with an outward normal", (id) => {
    const expected = EXPECTED[id];
    const frame = faceFrame(id, SIZE);
    expect(frame.plane).toBe(expected.plane);
    expect(frame.normal).toEqual(expected.normal);
    expect(pointOnFace(id, SIZE, expected.at)).toEqual(expected.point);
    expect(faceNormal(faceQuad(id, SIZE))).toEqual(expected.normal);
  });

  it("rejects an unknown face id", () => {
    expect(() => parseFaceId("LxW")).toThrow(/Unknown face/);
  });
});

describe("placeBore", () => {
  it("places a circle on LxW@1", () => {
    const hole = placeBore({ face: "LxW@1", at: [3, 1], diameter: 0.5 }, SIZE);
    expect(hole.center).toEqual([3, 2, 1]);
    expect(hole.normal).toEqual([0, 1, 0]);
  });

  it("bores a blind hole to the given depth", () => {
    const hole = placeBore({ face: "LxW@1", at: [3, 1], diameter: 0.5, depth: 0.5 }, SIZE);
    expect(hole.center).toEqual([3, 2, 1]);
    expect(hole.depth).toBe(0.5);
    expect(hole.through).toBe(false);
  });

  it("bores through the stock when depth is omitted", () => {
    const hole = placeBore({ face: "LxW@1", at: [3, 1], diameter: 0.5 }, SIZE);
    expect(hole.depth).toBe(2);
    expect(hole.through).toBe(true);
  });

  it("rejects a non-positive diameter", () => {
    expect(() => placeBore({ face: "LxW@0", at: [1, 1], diameter: 0 }, SIZE)).toThrow(/greater than 0/);
  });

  it("rejects a non-positive depth", () => {
    expect(() => placeBore({ face: "LxW@1", at: [3, 1], diameter: 0.5, depth: 0 }, SIZE)).toThrow(/depth must be greater than 0/);
  });

  it("rejects a depth past the stock extent", () => {
    expect(() => placeBore({ face: "LxW@1", at: [3, 1], diameter: 0.5, depth: 3 }, SIZE)).toThrow(/deeper than the stock/);
  });

  it("rejects a center outside the stock face", () => {
    expect(() => placeBore({ face: "LxW@1", at: [11, 1], diameter: 0.25 }, SIZE)).toThrow(/outside the stock face/);
  });

  it("rejects a circle that hangs off the face", () => {
    expect(() => placeBore({ face: "LxW@0", at: [0.1, 1], diameter: 1 }, SIZE)).toThrow(/extends past the stock face/);
  });
});
