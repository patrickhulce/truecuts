import { describe, expect, it } from "vitest";
import { attachmentNeighborKeys, layoutScrewPoints, SCREW_PILOT_RATIO } from "./connections";
import { compileDocument } from "./compile";
import type { Face, Vec3 } from "./geometry";

const NORMAL: Vec3 = [0, 0, 1];

function rect(width: number, height: number): Face {
  return [
    [0, 0, 0],
    [width, 0, 0],
    [width, height, 0],
    [0, height, 0],
  ];
}

const STACK = `version: 1
name: Stack
members:
  - label: A
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 10 }
  - label: B
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 10 }
components:
  - label: Box
    members:
      - { id: a-1, position: [0, 0, 0] }
      - { id: b-1, position: [0, 1.5, 0] }
`;

function withFastener(variant: string): string {
  return `${STACK}    connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: screw, stock: screw-wood-8x2, variant: { ${variant} } }
`;
}

describe("layoutScrewPoints", () => {
  const face = rect(10, 3.5);

  it("places four-corners on the inset corners", () => {
    const points = layoutScrewPoints({ kind: "four-corners", edge: 0.5 }, face, NORMAL);
    expect(points).toHaveLength(4);
    for (const expected of [
      [0.5, 0.5, 0],
      [9.5, 0.5, 0],
      [9.5, 3, 0],
      [0.5, 3, 0],
    ]) {
      expect(points.some((point) => point.every((coord, index) => Math.abs(coord - expected[index]) < 1e-4))).toBe(
        true,
      );
    }
  });

  it("places an angle-bracket screw at the inset centroid", () => {
    const points = layoutScrewPoints(
      { kind: "angle-bracket", bracket: "corner-bracket-1", edge: 0.5 },
      face,
      NORMAL,
    );
    expect(points).toHaveLength(1);
    expect(points[0][0]).toBeCloseTo(5, 4);
    expect(points[0][1]).toBeCloseTo(1.75, 4);
  });

  it("spaces centered fasteners with space-between and space-around", () => {
    const between = layoutScrewPoints(
      { kind: "centered", separation: 4, justify: "space-between" },
      face,
      NORMAL,
    );
    const around = layoutScrewPoints(
      { kind: "centered", separation: 4, justify: "space-around" },
      face,
      NORMAL,
    );
    expect(between).toHaveLength(4);
    expect(around).toHaveLength(3);
    expect(between[0][0]).toBeCloseTo(0, 4);
    expect(between[3][0]).toBeCloseTo(10, 4);
    for (const point of [...between, ...around]) {
      expect(point[1]).toBeCloseTo(1.75, 4);
    }
    expect(around[0][0]).toBeGreaterThan(0.5);
    expect(around[2][0]).toBeLessThan(9.5);
    for (let index = 1; index < between.length; index++) {
      expect(between[index][0] - between[index - 1][0]).toBeLessThanOrEqual(4 + 1e-6);
    }
  });

  it("walks a perimeter inset by edge", () => {
    const points = layoutScrewPoints(
      { kind: "perimeter", edge: 0.75, separation: 6, justify: "space-between" },
      face,
      NORMAL,
    );
    expect(points.length).toBeGreaterThanOrEqual(4);
    for (const point of points) {
      expect(point[0]).toBeGreaterThan(0.5);
      expect(point[0]).toBeLessThan(9.5);
      expect(point[1]).toBeGreaterThan(0.5);
      expect(point[1]).toBeLessThan(3);
    }
  });
});

describe("expandConnections", () => {
  it("derives clearance through the head and a pilot in the tip", () => {
    const result = compileDocument(withFastener("kind: four-corners, edge: 0.5"));
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const scene = result.scene;
    expect(scene).toBeDefined();
    const screws = scene!.fasteners.filter((fastener) => fastener.subtype === "screw");
    expect(screws).toHaveLength(4);
    expect(screws.every((fastener) => fastener.connectionKey === "box-1/connection#0")).toBe(true);

    const head = scene!.components[0].members.find((member) => member.memberId === "a-1");
    const tip = scene!.components[0].members.find((member) => member.memberId === "b-1");
    expect(head?.bores).toEqual([]);
    expect(tip?.bores).toEqual([]);
    expect(head?.derivedBores).toHaveLength(4);
    expect(tip?.derivedBores).toHaveLength(4);
    expect(head?.derivedBores.every((bore) => bore.through && Math.abs(bore.diameter - 0.164) < 1e-6)).toBe(true);
    expect(
      tip?.derivedBores.every(
        (bore) => !bore.through && Math.abs(bore.diameter - 0.164 * SCREW_PILOT_RATIO) < 1e-6 && bore.depth < 1,
      ),
    ).toBe(true);
    expect(scene!.connections[0].bores).toHaveLength(8);
    expect(screws.every((fastener) => fastener.headCovered)).toBe(false);
  });

  it("pilots only the tip when the screw does not span the head", () => {
    const result = compileDocument(`version: 1
name: Butt
members:
  - label: A
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 10 }
  - label: B
    stock: 2x4x8
    cuts:
      - { axis: 0, angle: 90, at: 10 }
components:
  - label: Box
    members:
      - { id: a-1, position: [0, 0, 0] }
      - { id: b-1, position: [10, 0, 0] }
    connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: screw, stock: screw-wood-8x2, variant: { kind: centered, separation: 6, justify: space-around } }
`);
    expect(result.diagnostics).toEqual([]);
    const head = result.scene?.components[0].members.find((member) => member.memberId === "a-1");
    const tip = result.scene?.components[0].members.find((member) => member.memberId === "b-1");
    expect(result.scene?.fasteners).toHaveLength(1);
    expect(head?.bores).toEqual([]);
    expect(head?.derivedBores).toEqual([]);
    expect(tip?.bores).toEqual([]);
    expect(tip?.derivedBores).toHaveLength(1);
    expect(tip?.derivedBores[0].depth).toBeCloseTo(2, 4);
    expect(tip?.derivedBores[0].diameter).toBeCloseTo(0.164 * SCREW_PILOT_RATIO, 6);
    expect(result.scene?.fasteners[0].headCovered).toBe(true);
  });

  it("places a glue bead and no bores", () => {
    const result = compileDocument(`${STACK}    connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: glue, stock: wood-glue }
`);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene?.fasteners.map((fastener) => fastener.subtype)).toEqual(["glue"]);
    expect(result.scene?.components[0].members.every((member) => member.bores.length === 0 && member.derivedBores.length === 0)).toBe(true);
    expect(result.scene?.connections[0].bores).toEqual([]);
  });

  it("keeps a connection with no fastener and no contact warning", () => {
    const result = compileDocument(`${STACK.replace("position: [0, 1.5, 0]", "position: [0, 10, 0]")}    connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: none }
`);
    expect(result.diagnostics.filter((item) => item.message.includes("no contact"))).toEqual([]);
    expect(result.scene?.fasteners).toEqual([]);
    expect(result.scene?.connections).toHaveLength(1);
    expect(result.scene?.connections[0].fasteners).toEqual([{ kind: "none" }]);
    expect(result.scene?.connections[0].bores).toEqual([]);
  });

  it("bores a through bolt for clearance and warns when it is shorter than the joint", () => {
    const short = compileDocument(`${STACK}    connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: bolt, stock: bolt-hex-1/4x2, variant: { kind: through } }
`);
    expect(short.scene).toBeDefined();
    expect(short.diagnostics.some((item) => item.severity === "warning" && item.message.includes("does not span"))).toBe(
      true,
    );
    const bolt = short.scene!.fasteners[0];
    expect(bolt.subtype).toBe("bolt");
    expect(bolt.grip).toBeCloseTo(3, 4);
    const head = short.scene!.components[0].members.find((member) => member.memberId === "a-1");
    const tip = short.scene!.components[0].members.find((member) => member.memberId === "b-1");
    expect(head?.derivedBores).toHaveLength(1);
    expect(tip?.derivedBores).toHaveLength(1);
    expect(head?.derivedBores[0].through).toBe(true);
    expect(tip?.derivedBores[0].through).toBe(true);
    expect(head?.derivedBores[0].diameter).toBeCloseTo(0.25, 6);
    expect(tip?.derivedBores[0].diameter).toBeCloseTo(0.25, 6);

    const spans = compileDocument(`${STACK}    connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: bolt, stock: bolt-hex-1/4x4, variant: { kind: through } }
`);
    expect(spans.diagnostics.filter((item) => item.message.includes("does not span"))).toEqual([]);
    expect(spans.scene?.fasteners[0].grip).toBeCloseTo(3, 4);
  });

  it("bolts every saddle flange instead of only the largest patch", () => {
    const result = compileDocument(`version: 1
name: Saddle
members:
  - label: Block
    stock: 6x6x8
    cuts:
      - { axis: 0, angle: 90, at: 5.5 }
  - label: Hanger
    stock: saddle
    size: [5.5, 5.5]
components:
  - label: Joint
    members:
      - { id: block-1, position: [0, 0.5, 0] }
      - { id: hanger-1, position: [0, 0, -0.25] }
    connections:
      - members:
          - { id: hanger-1 }
          - { id: block-1 }
        fasteners:
          - { kind: bolt, stock: bolt-hex-1/2x6, variant: { kind: angle-bracket, bracket: hanger-1, edge: 0.25 } }
`);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.diagnostics.filter((item) => item.message.includes("does not span"))).toEqual([]);
    const bolts = result.scene?.fasteners ?? [];
    expect(bolts).toHaveLength(2);
    expect(bolts.every((bolt) => bolt.subtype === "bolt" && bolt.grip !== undefined && bolt.grip > 5)).toBe(true);
    const block = result.scene?.components[0].members.find((member) => member.memberId === "block-1");
    const hanger = result.scene?.components[0].members.find((member) => member.memberId === "hanger-1");
    expect(block?.derivedBores).toHaveLength(2);
    expect(hanger?.derivedBores).toHaveLength(2);
    expect(block?.derivedBores.every((bore) => bore.diameter === 0.5 && bore.through)).toBe(true);
    expect(hanger?.derivedBores.every((bore) => bore.diameter === 0.5)).toBe(true);
  });

  it("warns when a member never touches the others and still renders", () => {
    const result = compileDocument(`${STACK.replace("position: [0, 1.5, 0]", "position: [0, 10, 0]")}    connections:
      - members:
          - { id: a-1 }
          - { id: b-1 }
        fasteners:
          - { kind: glue, stock: wood-glue }
`);
    expect(result.scene).toBeDefined();
    expect(result.diagnostics.some((item) => item.severity === "warning" && item.message.includes("no contact"))).toBe(
      true,
    );
  });
});

describe("attachmentNeighborKeys", () => {
  it("lists the other member of a none connection", () => {
    expect(attachmentNeighborKeys("box-1/a-1#0", [{ memberKeys: ["box-1/a-1#0", "box-1/b-1#0"] }], [])).toEqual([
      "box-1/b-1#0",
    ]);
  });

  it("keeps the wood neighbor when the direct screw is cleared and a bracket connection remains", () => {
    const apron = "bench-1/long-apron-1#0";
    const leg = "bench-1/leg-1#0";
    const bracket = "bench-1/corner-bracket-1#0";
    const keys = attachmentNeighborKeys(
      apron,
      [{ memberKeys: [apron, leg] }, { memberKeys: [bracket, apron, leg] }],
      [],
    );
    expect(keys).toContain(leg);
    expect(keys).toContain(bracket);
  });

  it("includes an explicit fastener neighbor that has no connection", () => {
    expect(
      attachmentNeighborKeys("a", [], [{ members: [{ instanceKey: "a" }, { instanceKey: "c" }] }]),
    ).toEqual(["c"]);
  });
});
