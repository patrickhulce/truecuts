import { describe, expect, it } from "vitest";
import { validateDocument } from "./schema";

const base = {
  version: 1 as const,
  name: "Test",
};

describe("validateDocument", () => {
  it("derives ids from labels", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [
        { label: "Leg", stock: "2x4x8", cuts: [{ axis: 0, angle: 90, at: 34 }] },
        { label: "Leg", stock: "2x4x8" },
        { label: "Top", stock: "plywood-3/4-4x8" },
      ],
      components: [
        {
          label: "Horse",
          members: [{ id: "leg-1", position: [0, 0, 0] }],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(document?.members.map((part) => part.id)).toEqual(["leg-1", "leg-2", "top-1"]);
    expect(document?.components[0].id).toBe("horse-1");
  });

  it("keeps explicit ids that match the regex", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [{ id: "top-1", label: "Top", stock: "plywood-3/4-4x8" }],
    });
    expect(issues).toEqual([]);
    expect(document?.members[0].id).toBe("top-1");
  });

  it("rejects malformed ids", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [{ id: "Top", label: "Top", stock: "2x4x8" }],
    });
    expect(document).toBeUndefined();
    expect(issues.some((issue) => issue.message.includes("Invalid id"))).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const { issues } = validateDocument({
      ...base,
      members: [
        { id: "leg-1", label: "Leg", stock: "2x4x8" },
        { id: "leg-1", label: "Other", stock: "2x4x8" },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("Duplicate"))).toBe(true);
  });

  it("rejects unknown part references", () => {
    const { issues } = validateDocument({
      ...base,
      members: [{ label: "Leg", stock: "2x4x8" }],
      components: [{ label: "Horse", members: [{ id: "missing-1" }] }],
    });
    expect(issues.some((issue) => issue.message.includes("Unknown member"))).toBe(true);
  });

  it("requires a range iff the cut is not square", () => {
    const squareRange = validateDocument({
      ...base,
      members: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 90, at: [1, 2] }] }],
    });
    expect(squareRange.issues.length).toBeGreaterThan(0);

    const angledSingle = validateDocument({
      ...base,
      members: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 45, at: 10 }] }],
    });
    expect(angledSingle.issues.length).toBeGreaterThan(0);

    const angledRange = validateDocument({
      ...base,
      members: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 45, at: [10, 14] }] }],
    });
    expect(angledRange.issues).toEqual([]);
    expect(angledRange.document?.members[0].cuts[0].at).toEqual([10, 14]);
  });

  it("rejects short >= long", () => {
    const { issues } = validateDocument({
      ...base,
      members: [{ label: "A", stock: "2x4x8", cuts: [{ axis: 0, angle: 45, at: [10, 10] }] }],
    });
    expect(issues.some((issue) => issue.message.includes("short point"))).toBe(true);
  });

  const twoParts = {
    ...base,
    members: [
      { label: "A", stock: "2x4x8" },
      { label: "B", stock: "2x4x8" },
    ],
    components: [
      {
        label: "Box",
        members: [{ id: "a-1", position: [0, 0, 0] }, { id: "b-1", position: [4, 0, 0] }],
      },
    ],
  };

  it("accepts a component-level screw fastener", () => {
    const { document, issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          fasteners: [
            {
              stock: "screw-wood-8x2.5",
              members: [
                { id: "a-1", at: [4, 1.75, 0.75], direction: [1, 0, 0] },
                { id: "b-1", at: [0, 1.75, 0.75], direction: [-1, 0, 0] },
              ],
            },
          ],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(document?.components[0].fasteners).toHaveLength(1);
    expect(document?.components[0].fasteners[0].members[0].component).toBe("box-1");
  });

  it("accepts a document-level glue fastener across components", () => {
    const { document, issues } = validateDocument({
      ...twoParts,
      components: [
        twoParts.components[0],
        { label: "Other", members: [{ id: "b-1", position: [0, 0, 0] }] },
      ],
      fasteners: [
        {
          stock: "wood-glue",
          members: [
            { component: "box-1", id: "a-1", at: [0, 0, 0] },
            { component: "other-1", id: "b-1", at: [0, 0, 0] },
          ],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(document?.fasteners).toHaveLength(1);
  });

  it("rejects an unknown fastener part", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          fasteners: [
            {
              stock: "screw-wood-8x2.5",
              members: [
                { id: "missing-1", at: [0, 0, 0], direction: [1, 0, 0] },
                { id: "b-1", at: [0, 0, 0], direction: [-1, 0, 0] },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("Unknown member"))).toBe(true);
  });

  it("rejects a one-member fastener", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          fasteners: [
            {
              stock: "wood-glue",
              members: [{ id: "a-1", at: [0, 0, 0] }],
            },
          ],
        },
      ],
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects using a screw as part stock", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [{ label: "Bad", stock: "screw-wood-8x2.5" }],
    });
    expect(issues).toEqual([]);
    expect(document?.members[0].stock).toBe("screw-wood-8x2.5");
  });

  it("rejects fastener stock that is not kind fastener", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          fasteners: [
            {
              stock: "2x4x8",
              members: [
                { id: "a-1", at: [0, 0, 0], direction: [1, 0, 0] },
                { id: "b-1", at: [0, 0, 0], direction: [-1, 0, 0] },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("kind fastener"))).toBe(true);
  });

  it("rejects a glue fastener with one member after catalog check", () => {
    const { issues } = validateDocument({
      ...twoParts,
      fasteners: [
        {
          stock: "wood-glue",
          members: [
            { component: "box-1", id: "a-1", at: [0, 0, 0] },
            { component: "box-1", id: "b-1", at: [0, 0, 0] },
          ],
        },
      ],
    });
    // two members is valid glue
    expect(issues.filter((issue) => issue.message.toLowerCase().includes("member")).length).toBe(0);
  });

  it("rejects a screw missing direction", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          fasteners: [
            {
              stock: "screw-wood-8x2.5",
              members: [
                { id: "a-1", at: [0, 0, 0] },
                { id: "b-1", at: [0, 0, 0], direction: [-1, 0, 0] },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("direction"))).toBe(true);
  });

  it("rejects a screw with three members", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          fasteners: [
            {
              stock: "screw-wood-8x2.5",
              members: [
                { id: "a-1", at: [0, 0, 0], direction: [1, 0, 0] },
                { id: "b-1", at: [0, 0, 0], direction: [-1, 0, 0] },
                { id: "a-1", at: [1, 0, 0], direction: [1, 0, 0] },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("exactly two members"))).toBe(true);
  });

  it("rejects a bracket used as fastener stock", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          fasteners: [
            {
              stock: "bracket-l-2x2",
              members: [
                { id: "a-1", at: [0, 0, 0], direction: [1, 0, 0] },
                { id: "b-1", at: [0, 0, 0], direction: [0, 1, 0] },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("kind fastener"))).toBe(true);
  });

  it("accepts a bracket as a placed part", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [{ label: "Corner bracket", stock: "bracket-l-2x2" }],
      components: [{ label: "Box", members: [{ id: "corner-bracket-1" }] }],
    });
    expect(issues).toEqual([]);
    expect(document?.members[0].stock).toBe("bracket-l-2x2");
  });

  it("places a hole on LxW@1", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [
        {
          label: "Top",
          stock: "plywood-3/4-4x8",
          bores: [{ face: "LxW@1", at: [20, 12], diameter: 1 }],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(document?.members[0].bores[0]).toEqual({
      face: "LxW@1",
      at: [20, 12],
      diameter: 1,
      depth: 0.75,
      through: true,
      center: [20, 0.75, 12],
      normal: [0, 1, 0],
    });
  });

  it("rejects an unknown face id", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [{ label: "Top", stock: "2x4x8", bores: [{ face: "LxW", at: [1, 1], diameter: 0.25 }] }],
    });
    expect(document).toBeUndefined();
    expect(issues.some((issue) => issue.path.includes("face"))).toBe(true);
  });

  it("rejects a hole center outside the stock face", () => {
    const { issues } = validateDocument({
      ...base,
      members: [{ label: "Leg", stock: "2x4x8", bores: [{ face: "LxW@1", at: [100, 1], diameter: 0.25 }] }],
    });
    expect(issues.some((issue) => issue.message.includes("outside the stock face"))).toBe(true);
  });

  it("rejects a non-positive hole diameter", () => {
    const { issues } = validateDocument({
      ...base,
      members: [{ label: "Leg", stock: "2x4x8", bores: [{ face: "LxW@0", at: [4, 1], diameter: 0 }] }],
    });
    expect(issues.some((issue) => issue.message.includes("greater than 0"))).toBe(true);
  });

  it("rejects a hole that hangs off the stock face", () => {
    const { issues } = validateDocument({
      ...base,
      members: [{ label: "Leg", stock: "2x4x8", bores: [{ face: "LxW@0", at: [0.1, 1], diameter: 1 }] }],
    });
    expect(issues.some((issue) => issue.message.includes("extends past the stock face"))).toBe(true);
  });

  it("accepts a flat L-bracket as a placed part", () => {
    const { document, issues } = validateDocument({
      ...base,
      members: [{ label: "Flat bracket", stock: "bracket-flat-l-2x1" }],
      components: [{ label: "Box", members: [{ id: "flat-bracket-1" }] }],
    });
    expect(issues).toEqual([]);
    expect(document?.members[0].stock).toBe("bracket-flat-l-2x1");
  });

  it("accepts a perimeter screw connection and parses variant options", () => {
    const { document, issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [
            {
              members: [{ id: "a-1" }, { id: "b-1" }],
              fasteners: [
                {
                  kind: "screw",
                  stock: "screw-wood-8x2",
                  variant: { kind: "perimeter", edge: '3/4"', separation: 4, justify: "space-between" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(document?.components[0].connections[0].members[0].component).toBe("box-1");
    expect(document?.components[0].connections[0].fasteners[0]).toEqual({
      kind: "screw",
      stock: "screw-wood-8x2",
      variant: { kind: "perimeter", edge: 0.75, separation: 4, justify: "space-between" },
    });
  });

  it("rejects an empty connection", () => {
    const { document, issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [{ members: [{ id: "a-1" }, { id: "b-1" }], fasteners: [] }],
        },
      ],
    });
    expect(document).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a none fastener with no stock", () => {
    const { document, issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [{ members: [{ id: "a-1" }, { id: "b-1" }], fasteners: [{ kind: "none" }] }],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(document?.components[0].connections[0].fasteners).toEqual([{ kind: "none" }]);
  });

  it("rejects unknown connection stock", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [
            {
              members: [{ id: "a-1" }, { id: "b-1" }],
              fasteners: [
                {
                  kind: "screw",
                  stock: "missing-screw",
                  variant: { kind: "centered", separation: 4, justify: "space-around" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("Unknown fastener stock"))).toBe(true);
  });

  it("rejects stock whose subtype does not match the fastener kind", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [
            {
              members: [{ id: "a-1" }, { id: "b-1" }],
              fasteners: [
                { kind: "bolt", stock: "screw-wood-8x2", variant: { kind: "through" } },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("is a screw, not a bolt"))).toBe(true);
  });

  it("requires component on document-level connection members and forbids it inside a component", () => {
    const missing = validateDocument({
      ...twoParts,
      connections: [
        {
          members: [{ id: "a-1" }, { id: "b-1" }],
          fasteners: [{ kind: "glue", stock: "wood-glue" }],
        },
      ],
    });
    expect(missing.issues.some((issue) => issue.message.includes("Document-level"))).toBe(true);

    const extra = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [
            {
              members: [{ id: "a-1", component: "box-1" }, { id: "b-1" }],
              fasteners: [{ kind: "glue", stock: "wood-glue" }],
            },
          ],
        },
      ],
    });
    expect(extra.issues.some((issue) => issue.message.includes("Component-level"))).toBe(true);
  });

  it("rejects an angle-bracket that is not one of the connection members", () => {
    const { issues } = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [
            {
              members: [{ id: "a-1" }, { id: "b-1" }],
              fasteners: [
                {
                  kind: "screw",
                  stock: "screw-wood-8x1.25",
                  variant: { kind: "angle-bracket", bracket: "missing-1", edge: 0.25 },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("must be one of the connection members"))).toBe(true);
  });

  it("rejects variant options that do not fit the layout", () => {
    const separation = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [
            {
              members: [{ id: "a-1" }, { id: "b-1" }],
              fasteners: [
                {
                  kind: "screw",
                  stock: "screw-wood-8x2",
                  variant: { kind: "centered", separation: 0, justify: "space-around" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(separation.issues.some((issue) => issue.message.includes("separation must be greater than 0"))).toBe(true);

    const edge = validateDocument({
      ...twoParts,
      components: [
        {
          ...twoParts.components[0],
          connections: [
            {
              members: [{ id: "a-1" }, { id: "b-1" }],
              fasteners: [
                {
                  kind: "screw",
                  stock: "screw-wood-8x2",
                  variant: { kind: "four-corners", edge: -1 },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(edge.issues.some((issue) => issue.message.includes("edge must be 0 or greater"))).toBe(true);
  });
});
