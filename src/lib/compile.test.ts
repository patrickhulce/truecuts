import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDocument } from "./compile";
import { DEMO_YAML } from "./demo";
import { applyPose, type Vec3 } from "./geometry";
import type { SceneComponent, SceneMemberInstance } from "./scene";

const UNDERSIDE_ORIGINS: Record<string, { position: Vec3; side: "left" | "right" }> = {
  "corner-bracket-1": { position: [3.5, 26.5, 1.5], side: "left" },
  "corner-bracket-2": { position: [36.5, 26.5, 0], side: "right" },
  "corner-bracket-3": { position: [3.5, 26.5, 24], side: "left" },
  "corner-bracket-4": { position: [36.5, 26.5, 22.5], side: "right" },
};

function worldAabb(
  position: Vec3,
  rotation: Vec3,
  min: Vec3,
  max: Vec3,
  component: Pick<SceneComponent, "position" | "rotation"> = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  },
): { min: Vec3; max: Vec3 } {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const world = applyPose(applyPose([x, y, z], position, rotation), component.position, component.rotation);
        xs.push(world[0]);
        ys.push(world[1]);
        zs.push(world[2]);
      }
    }
  }
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
  };
}

function contains(bounds: { min: Vec3; max: Vec3 }, point: Vec3, slack = 1e-4): boolean {
  return (
    point[0] >= bounds.min[0] - slack &&
    point[0] <= bounds.max[0] + slack &&
    point[1] >= bounds.min[1] - slack &&
    point[1] <= bounds.max[1] + slack &&
    point[2] >= bounds.min[2] - slack &&
    point[2] <= bounds.max[2] + slack
  );
}

describe("compileDocument", () => {
  it("keeps DEMO_YAML in sync with examples/demo.yaml", () => {
    const fromFile = readFileSync(new URL("../../examples/demo.yaml", import.meta.url), "utf8");
    expect(DEMO_YAML).toBe(fromFile);
  });

  it("compiles the demo YAML into a scene", () => {
    const result = compileDocument(DEMO_YAML);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.document?.members).toHaveLength(16);
    expect(result.document?.members.map((part) => part.id)).toEqual([
      "leg-1",
      "leg-2",
      "leg-3",
      "leg-4",
      "long-apron-1",
      "long-apron-2",
      "short-apron-1",
      "short-apron-2",
      "brace-1",
      "top-1",
      "shelf-board-1",
      "spare-block-1",
      "corner-bracket-1",
      "corner-bracket-2",
      "corner-bracket-3",
      "corner-bracket-4",
    ]);
    expect(result.scene?.components).toHaveLength(3);
    expect(result.scene?.components[0].members).toHaveLength(14);
    expect(result.scene?.fasteners.length).toBeGreaterThan(0);
    expect(result.diagnostics.filter((item) => item.severity === "warning")).toEqual([]);

    const components = result.scene!.components;
    const byId = new Map(components.flatMap((component) => component.members).map((part) => [part.memberId, part]));
    const byKey = new Map<string, { component: SceneComponent; part: SceneMemberInstance }>();
    for (const component of components) {
      for (const part of component.members) {
        byKey.set(part.key, { component, part });
      }
    }

    expect(byId.get("leg-1")?.fastened).toBe(true);
    expect(byId.get("long-apron-1")?.fastened).toBe(true);
    expect(byId.get("top-1")?.fastened).toBe(true);
    expect(byId.get("top-1")?.bores).toEqual(expect.arrayContaining([
      {
        face: "LxW@1",
        at: [20, 12],
        diameter: 1,
        depth: 0.5,
        through: false,
        center: [20, 0.75, 12],
        normal: [0, 1, 0],
      },
    ]));
    expect(byId.get("shelf-board-1")?.fastened).toBe(true);
    expect(byId.get("corner-bracket-1")?.fastened).toBe(true);
    expect(byId.get("corner-bracket-4")?.fastened).toBe(true);
    expect(byId.get("brace-1")?.fastened).toBe(true);
    expect(byId.get("spare-block-1")?.fastened).toBe(false);

    const leg1 = byId.get("leg-1");
    expect(leg1?.worldCenter[0]).toBeCloseTo(1.75, 5);
    expect(leg1?.worldCenter[1]).toBeCloseTo(15, 5);
    expect(leg1?.worldCenter[2]).toBeCloseTo(0.75, 5);
    expect(result.scene!.center[0]).toBeGreaterThan(0);
    expect(result.scene!.center[1]).toBeGreaterThan(0);
    expect(result.scene!.center[2]).toBeGreaterThan(0);

    const screws = result.scene!.fasteners.filter((fastener) => fastener.subtype === "screw");
    const touches = (screw: (typeof screws)[number], id: string) =>
      screw.members.some((member) => member.instanceKey.includes(id));
    const butt = screws.filter(
      (screw) =>
        !touches(screw, "corner-bracket") &&
        screw.members.some((member) => /apron-|brace-/.test(member.instanceKey)) &&
        screw.members.some((member) => member.instanceKey.includes("leg-")),
    );
    expect(butt.length).toBeGreaterThan(0);
    expect(butt.every((screw) => screw.headCovered)).toBe(true);
    expect(screws.filter((screw) => touches(screw, "corner-bracket")).every((screw) => !screw.headCovered)).toBe(true);
    expect(screws.filter((screw) => touches(screw, "top-1")).every((screw) => !screw.headCovered)).toBe(true);
    expect(result.scene!.fasteners.filter((fastener) => fastener.subtype === "glue").every((fastener) => !fastener.headCovered)).toBe(
      true,
    );
    for (const screw of screws) {
      const [a, b] = screw.members;
      const gap = Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1], a.point[2] - b.point[2]);
      expect(gap, screw.key).toBeLessThan(0.25);
    }

    const bracketScrews = screws.filter((fastener) =>
      fastener.members.some((member) => member.instanceKey.includes("corner-bracket")),
    );
    expect(bracketScrews).toHaveLength(8);
    for (const screw of bracketScrews) {
      const woodMember = screw.members.find((member) => !member.instanceKey.includes("corner-bracket"));
      expect(woodMember, screw.key).toBeDefined();
      const wood = byKey.get(woodMember!.instanceKey);
      expect(wood, screw.key).toBeDefined();
      const length = Math.hypot(...screw.direction);
      expect(length, screw.key).toBeGreaterThan(1e-8);
      const along: Vec3 = [
        screw.origin[0] + (0.5 * screw.direction[0]) / length,
        screw.origin[1] + (0.5 * screw.direction[1]) / length,
        screw.origin[2] + (0.5 * screw.direction[2]) / length,
      ];
      const woodBounds = worldAabb(
        wood!.part.position,
        wood!.part.rotation,
        wood!.part.bounds.min,
        wood!.part.bounds.max,
        wood!.component,
      );
      expect(contains(woodBounds, along), `${screw.key} shank ${along}`).toBe(true);
    }

    for (const [id, spec] of Object.entries(UNDERSIDE_ORIGINS)) {
      const bracket = byId.get(id);
      expect(bracket, id).toBeDefined();
      expect(bracket!.position).toEqual(spec.position);
      const aabb = worldAabb(bracket!.position, bracket!.rotation, bracket!.bounds.min, bracket!.bounds.max);
      expect(aabb.max[1], id).toBeCloseTo(26.5, 5);
      expect(aabb.min[1], id).toBeLessThan(26.5 - 0.5);
      if (spec.side === "left") {
        expect(aabb.min[0], id).toBeCloseTo(3.5, 5);
        expect(aabb.max[0], id).toBeGreaterThan(3.5);
      } else {
        expect(aabb.max[0], id).toBeCloseTo(36.5, 5);
        expect(aabb.min[0], id).toBeLessThan(36.5);
      }
    }
  });

  it("reports YAML parse errors with line numbers", () => {
    const result = compileDocument("version: [\n");
    expect(result.scene).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].line).toBeDefined();
  });
});
