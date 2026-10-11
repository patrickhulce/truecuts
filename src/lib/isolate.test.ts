import { describe, expect, it } from "vitest";
import { applyPose, type Vec3 } from "./geometry";
import { isolateComponent, isolateConnections, isolateFasteners, isolatePoint } from "./isolate";
import type { SceneComponent, SceneMemberInstance } from "./scene";
import type { SceneFastener } from "./fasteners";
import type { SceneConnection } from "./connections";

const FACE: SceneMemberInstance["faces"] = [
  [
    [0, 0, 0],
    [2, 0, 0],
    [2, 1, 0],
    [0, 1, 0],
  ],
];

function member(key: string, position: Vec3): SceneMemberInstance {
  return {
    key,
    memberId: key,
    label: key,
    stockId: "stock",
    stockLabel: "stock",
    material: "wood",
    color: "#fff",
    faces: FACE,
    bores: [],
    derivedBores: [],
    position,
    rotation: [0, 0, 0],
    bounds: { min: [0, 0, 0], max: [2, 1, 0] },
    worldBounds: { min: [0, 0, 0], max: [1, 1, 1] },
    worldCenter: [0, 0, 0],
    finished: { length: 2, width: 0, thickness: 1 },
    fastened: true,
  };
}

function component(
  id: string,
  position: Vec3,
  rotation: Vec3,
  members: SceneMemberInstance[],
  children: SceneComponent[] = [],
): SceneComponent {
  return {
    id,
    templateId: id,
    label: id,
    index: 0,
    position,
    rotation,
    worldPosition: position,
    worldRotation: rotation,
    members,
    children,
  };
}

describe("isolateComponent", () => {
  const leg = member("bench-1/trestle-1#0/leg-1#0", [4, 1, 2]);
  const trestle = component("bench-1/trestle-1#0", [4, 1, 2], [0, 0, 0], [leg]);
  const bench = component("bench-1", [10, 0, 0], [0, 90, 0], [], [trestle]);

  it("sits the occurrence on the origin", () => {
    const view = isolateComponent(bench);
    expect(view.position).toEqual([0, 0, 0]);
    expect(view.rotation).toEqual([0, 0, 0]);
    expect(view.worldPosition).toEqual([0, 0, 0]);
    expect(view.worldRotation).toEqual([0, 0, 0]);
  });

  it("gives a nested child the world pose of its local pose", () => {
    const child = isolateComponent(bench).children[0];
    expect(child.position).toEqual([4, 1, 2]);
    expect(child.worldPosition[0]).toBeCloseTo(4, 5);
    expect(child.worldPosition[1]).toBeCloseTo(1, 5);
    expect(child.worldPosition[2]).toBeCloseTo(2, 5);
    expect(child.worldRotation[0]).toBeCloseTo(0, 5);
    expect(child.worldRotation[1]).toBeCloseTo(0, 5);
    expect(child.worldRotation[2]).toBeCloseTo(0, 5);
  });

  it("maps a world point on the part back into the component frame", () => {
    const onPart = applyPose([0, 0, 0], leg.position, leg.rotation);
    const world = applyPose(onPart, bench.worldPosition, bench.worldRotation);
    const local = isolatePoint(world, bench);
    expect(local[0]).toBeCloseTo(onPart[0], 5);
    expect(local[1]).toBeCloseTo(onPart[1], 5);
    expect(local[2]).toBeCloseTo(onPart[2], 5);
  });
});

describe("isolate joints", () => {
  const inside = "bench-1/leg-1#0";
  const outside = "shelf-1/board-1#0";
  const bench = component("bench-1", [8, 0, 0], [0, 0, 0], [member(inside, [1, 0, 0])]);

  function fastener(keys: string[], origin: Vec3): SceneFastener {
    return {
      key: keys.join("+"),
      stockId: "screw-wood-8x2.5",
      stockLabel: "screw",
      subtype: "screw",
      color: "#ccc",
      origin,
      direction: [0, 1, 0],
      length: 2,
      diameter: 0.16,
      size: [2, 0.16, 0.16],
      members: keys.map((instanceKey) => ({ instanceKey, point: origin })),
    };
  }

  it("drops a joint that leaves the component and keeps one that stays", () => {
    const origin: Vec3 = [9, 2, 0];
    const fasteners = isolateFasteners(
      [fastener([inside, outside], origin), fastener([inside], origin)],
      bench,
    );
    expect(fasteners).toHaveLength(1);
    expect(fasteners[0]?.members.map((member) => member.instanceKey)).toEqual([inside]);
    expect(fasteners[0]?.origin[0]).toBeCloseTo(1, 5);
    expect(fasteners[0]?.origin[1]).toBeCloseTo(2, 5);

    const leaving: SceneConnection = {
      key: "out",
      componentId: null,
      index: 0,
      memberKeys: [inside, outside],
      fasteners: [],
      bores: [],
    };
    const staying: SceneConnection = { ...leaving, key: "in", memberKeys: [inside] };
    expect(isolateConnections([leaving, staying], bench).map((connection) => connection.key)).toEqual(["in"]);
  });
});
