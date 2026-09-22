import { describe, expect, it } from "vitest";
import { compileDocument } from "../compile";
import { DEMO_YAML } from "../demo";
import { findContacts, patchesFor, type PosedSolid } from "./contact";
import { boundingBox, boxPolyhedron } from "./solids";
import type { Vec3 } from "./types";

const ZERO: Vec3 = [0, 0, 0];

function boxSolid(key: string, size: Vec3, position: Vec3, rotation: Vec3 = ZERO): PosedSolid {
  const faces = boxPolyhedron(size);
  return {
    key,
    faces,
    position,
    rotation,
    componentPosition: ZERO,
    componentRotation: ZERO,
    bounds: boundingBox(faces),
  };
}

describe("findContacts", () => {
  it("finds one full-face patch between stacked boxes and keeps host quads", () => {
    const a = boxSolid("a", [2, 2, 1], ZERO);
    const b = boxSolid("b", [2, 2, 1], [0, 1, 0]);
    const contacts = findContacts([a, b]);
    expect(contacts.patches).toHaveLength(1);
    expect(contacts.patches[0].area).toBeCloseTo(4, 5);
    expect(a.faces).toHaveLength(6);
    expect(b.faces).toHaveLength(6);
    const hostA = contacts.hosts.find((host) => host.instanceKey === "a");
    expect(hostA?.polygon).toHaveLength(4);
    expect(hostA?.patchKeys).toHaveLength(1);
  });

  it("slices a T-joint to the butt overlap on a long host", () => {
    const long = boxSolid("long", [10, 3.5, 1.5], ZERO);
    const stub = boxSolid("stub", [4, 3.5, 1.5], [10, 0, 0]);
    const contacts = findContacts([long, stub]);
    expect(contacts.patches).toHaveLength(1);
    expect(contacts.patches[0].area).toBeCloseTo(3.5 * 1.5, 5);
    const longHost = contacts.hosts.find((host) => host.instanceKey === "long");
    const xs = longHost!.polygon.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6);
    expect(longHost!.polygon).toHaveLength(4);
  });

  it("keeps four separate patches on one large plate host", () => {
    const plate = boxSolid("plate", [10, 10, 1], ZERO);
    const pads = [
      boxSolid("p0", [2, 2, 1], [0, 1, 0]),
      boxSolid("p1", [2, 2, 1], [8, 1, 0]),
      boxSolid("p2", [2, 2, 1], [0, 1, 8]),
      boxSolid("p3", [2, 2, 1], [8, 1, 8]),
    ];
    const contacts = findContacts([plate, ...pads]);
    const onPlate = patchesFor(contacts, "plate");
    expect(onPlate).toHaveLength(4);
    const host = contacts.hosts.find((h) => h.instanceKey === "plate");
    expect(host?.faceIndex).toBeDefined();
    expect(onPlate.every((patch) => patch.a.faceIndex === host?.faceIndex || patch.b.faceIndex === host?.faceIndex)).toBe(
      true,
    );
    expect(new Set(onPlate.map((patch) => (patch.a.instanceKey === "plate" ? patch.b.instanceKey : patch.a.instanceKey))).size).toBe(
      4,
    );
  });

  it("ignores a 0.01″ gap", () => {
    const a = boxSolid("a", [2, 2, 1], ZERO);
    const b = boxSolid("b", [2, 2, 1], [0, 1.01, 0]);
    expect(findContacts([a, b]).patches).toHaveLength(0);
  });
});

describe("demo contacts", () => {
  it("finds apron strips on the top, none on the spare block, and a shelf/apron patch", () => {
    const result = compileDocument(DEMO_YAML);
    expect(result.scene).toBeDefined();
    const posed: PosedSolid[] = result.scene!.components.flatMap((component) =>
      component.members.map((part) => ({
        key: part.key,
        faces: part.faces,
        position: part.position,
        rotation: part.rotation,
        componentPosition: component.position,
        componentRotation: component.rotation,
        bounds: part.bounds,
      })),
    );
    const contacts = findContacts(posed);
    const topKey = posed.find((p) => p.key.includes("top-1"))!.key;
    const spareKey = posed.find((p) => p.key.includes("spare-block-1"))!.key;
    const apronKeys = posed.filter((p) => p.key.includes("apron")).map((p) => p.key);
    const topPatches = patchesFor(contacts, topKey);
    const apronNeighbors = new Set(
      topPatches.map((patch) => (patch.a.instanceKey === topKey ? patch.b.instanceKey : patch.a.instanceKey)),
    );
    expect([...apronNeighbors].filter((key) => apronKeys.includes(key))).toHaveLength(4);
    expect(patchesFor(contacts, spareKey)).toHaveLength(0);

    const shelfKey = posed.find((p) => p.key.includes("shelf-board-1"))!.key;
    const longApron2 = posed.find((p) => p.key.includes("long-apron-2"))!.key;
    const shelfPatches = patchesFor(contacts, shelfKey);
    expect(
      shelfPatches.some(
        (patch) => patch.a.instanceKey === longApron2 || patch.b.instanceKey === longApron2,
      ),
    ).toBe(true);
  });
});
