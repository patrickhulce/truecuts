import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import { DEMO_YAML } from "./demo";
import { migrateDocumentYaml } from "./migrate";

const OLD = `version: 1
name: Old
parts:
  - label: A
    stock: 2x4x8
    holes:
      - { face: LxW@1, at: [4, 1], diameter: 0.25, depth: 0.5 }
  - label: B
    stock: 2x4x8
components:
  - label: Box
    parts:
      - { part: a-1, position: [0, 0, 0] }
      - { part: b-1, position: [4, 0, 0] }
    fasteners:
      - stock: wood-glue
        members:
          - { part: a-1, at: [1, 0.75, 1] }
          - { part: b-1, at: [1, 0.75, 1] }
fasteners:
  - stock: wood-glue
    members:
      - { component: box-1, part: a-1, at: [2, 0.75, 1] }
      - { component: box-1, part: b-1, at: [2, 0.75, 1] }
`;

describe("migrateDocumentYaml", () => {
  it("rewrites parts, holes, and placement part onto members, bores, and id", () => {
    const next = migrateDocumentYaml(OLD);
    expect(next).not.toMatch(/^parts:/m);
    expect(next).not.toMatch(/holes:/);
    expect(next).not.toMatch(/\bpart:/);
    expect(next).toMatch(/^members:/m);
    expect(next).toContain("bores:");
    expect(next).toContain("id: a-1");

    const result = compileDocument(next);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members[0].bores).toHaveLength(1);
    expect(result.document?.components[0].members.map((member) => member.id)).toEqual(["a-1", "b-1"]);
    expect(result.document?.components[0].fasteners[0].members[0].id).toBe("a-1");
    expect(result.document?.fasteners[0].members[1].id).toBe("b-1");
  });

  it("leaves current documents unchanged", () => {
    expect(migrateDocumentYaml(DEMO_YAML)).toBe(DEMO_YAML);
    expect(migrateDocumentYaml("not: [yaml")).toBe("not: [yaml");
  });
});
