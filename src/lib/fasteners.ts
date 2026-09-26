import { getCatalogPart, getFastenerSubtype, type FastenerSubtype } from "./catalog";
import { applyPose, dot, len, normalize, rotateEulerXYZ, type Vec3 } from "./geometry";
import type { ResolvedComponent, ResolvedDocument, ResolvedFastener, ResolvedPlacement } from "./schema";

export type SceneFastenerMember = {
  instanceKey: string;
  point: Vec3;
  direction?: Vec3;
};

export type SceneFastener = {
  key: string;
  stockId: string;
  stockLabel: string;
  subtype: FastenerSubtype;
  color: string;
  origin: Vec3;
  direction: Vec3;
  length: number;
  diameter: number;
  size: Vec3;
  /** Head face to tip exit, for a through bolt. The nut sits here. */
  grip?: number;
  /** In-plane axis of a T-connector bed. Local +X. Stem is `direction` (local +Y). */
  across?: Vec3;
  /** Stem height of a T-connector. */
  riser?: number;
  /**
   * Bed thickness seated opposite the stem. The plate sits on the post and the
   * flange continues through the beam.
   */
  bedInset?: number;
  members: SceneFastenerMember[];
  /** Set when this instance was expanded from a connection recipe. */
  connectionKey?: string;
  /** Screw head sits behind a member it joins, so a driver cannot reach it. */
  headCovered?: boolean;
};

export type FastenerIssue = {
  message: string;
  path: Array<string | number>;
  severity: "error" | "warning";
};

export function instanceKey(componentId: string, memberId: string, placementIndex: number): string {
  return `${componentId}/${memberId}#${placementIndex}`;
}

export function parseInstanceKey(key: string): {
  componentId: string;
  memberId: string;
  placementIndex: number;
} {
  const slash = key.indexOf("/");
  const hash = key.lastIndexOf("#");
  if (slash <= 0 || hash <= slash + 1 || hash === key.length - 1) {
    throw new Error(`Invalid instance key "${key}"`);
  }
  const placementIndex = Number(key.slice(hash + 1));
  if (!Number.isInteger(placementIndex) || placementIndex < 0) {
    throw new Error(`Invalid instance key "${key}"`);
  }
  return {
    componentId: key.slice(0, slash),
    memberId: key.slice(slash + 1, hash),
    placementIndex,
  };
}

/** 0-based occurrence of `memberId` in the component → index in `component.members`. */
export function placementIndexFor(
  component: { members: ResolvedPlacement[] },
  memberId: string,
  occurrence: number,
): number | undefined {
  let seen = 0;
  for (let index = 0; index < component.members.length; index++) {
    if (component.members[index].id !== memberId) continue;
    if (seen === occurrence) return index;
    seen += 1;
  }
  return undefined;
}

export function worldPoint(
  local: Vec3,
  placement: ResolvedPlacement,
  component: Pick<ResolvedComponent, "position" | "rotation">,
): Vec3 {
  return applyPose(applyPose(local, placement.position, placement.rotation), component.position, component.rotation);
}

export function worldDirection(
  local: Vec3,
  placement: ResolvedPlacement,
  component: Pick<ResolvedComponent, "position" | "rotation">,
): Vec3 {
  return rotateEulerXYZ(rotateEulerXYZ(local, placement.rotation), component.rotation);
}

function cliqueEdges(keys: string[]): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      edges.push([keys[i], keys[j]]);
    }
  }
  return edges;
}

export function fastenedFromSeed(nodes: string[], edges: Array<[string, string]>, seed?: string): Set<string> {
  const fastened = new Set<string>();
  if (!seed || !nodes.includes(seed)) return fastened;
  const adj = new Map<string, string[]>();
  for (const node of nodes) adj.set(node, []);
  for (const [a, b] of edges) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  const queue = [seed];
  fastened.add(seed);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adj.get(current) ?? []) {
      if (fastened.has(next)) continue;
      fastened.add(next);
      queue.push(next);
    }
  }
  return fastened;
}

type ResolveContext = {
  componentById: Map<string, ResolvedComponent>;
};

function resolveOne(
  fastener: ResolvedFastener,
  path: Array<string | number>,
  key: string,
  ctx: ResolveContext,
  issues: FastenerIssue[],
): { scene: SceneFastener; memberKeys: string[] } | undefined {
  const catalog = getCatalogPart(fastener.stock);
  const subtype = getFastenerSubtype(fastener.stock);
  if (!catalog || !subtype) {
    issues.push({
      message: `Unknown fastener stock "${fastener.stock}"`,
      path: [...path, "stock"],
      severity: "error",
    });
    return undefined;
  }

  const members: SceneFastenerMember[] = [];
  const memberKeys: string[] = [];

  for (const [mIndex, member] of fastener.members.entries()) {
    const component = ctx.componentById.get(member.component);
    if (!component) {
      issues.push({
        message: `Unknown component "${member.component}"`,
        path: [...path, "members", mIndex, "component"],
        severity: "error",
      });
      continue;
    }
    const placementIndex = placementIndexFor(component, member.id, member.index);
    if (placementIndex === undefined) {
      issues.push({
        message: `Member "${member.id}" is not placed in component "${member.component}"`,
        path: [...path, "members", mIndex, "id"],
        severity: "error",
      });
      continue;
    }
    const placement = component.members[placementIndex];
    const keyForMember = instanceKey(component.id, member.id, placementIndex);
    const point = worldPoint(member.at, placement, component);
    const direction = member.direction
      ? normalize(worldDirection(member.direction, placement, component))
      : undefined;
    members.push({ instanceKey: keyForMember, point, direction });
    memberKeys.push(keyForMember);
  }

  if (members.length !== fastener.members.length) {
    return undefined;
  }

  if ((subtype === "screw" || subtype === "bolt" || subtype === "nail") && members.length === 2) {
    const noun = subtype === "bolt" ? "Bolt" : subtype === "nail" ? "Nail" : "Screw";
    const gap = len([
      members[0].point[0] - members[1].point[0],
      members[0].point[1] - members[1].point[1],
      members[0].point[2] - members[1].point[2],
    ]);
    if (gap > 0.25) {
      issues.push({
        message: `${noun} member centerpoints are ${gap.toFixed(2)}″ apart in world space (expected to coincide)`,
        path,
        severity: "warning",
      });
    }
    const d0 = members[0].direction;
    const d1 = members[1].direction;
    if (d0 && d1 && dot(d0, d1) > -0.5) {
      issues.push({
        message: `${noun} member directions should be roughly opposite in world space`,
        path,
        severity: "warning",
      });
    }
  }

  const fallbackDir =
    members.length >= 2
      ? normalize([
          members[1].point[0] - members[0].point[0],
          members[1].point[1] - members[0].point[1],
          members[1].point[2] - members[0].point[2],
        ])
      : ([0, -1, 0] as Vec3);
  const direction = members[0].direction && len(members[0].direction) > 1e-8 ? members[0].direction : fallbackDir;
  const origin = members[0].point;

  return {
    scene: {
      key,
      stockId: catalog.id,
      stockLabel: catalog.label,
      subtype,
      color: catalog.color,
      origin,
      direction: len(direction) > 1e-8 ? direction : [0, -1, 0],
      length: catalog.size[0],
      diameter: catalog.size[1],
      size: catalog.size,
      members,
    },
    memberKeys,
  };
}

export function resolveFasteners(document: ResolvedDocument): {
  fasteners: SceneFastener[];
  edges: Array<[string, string]>;
  issues: FastenerIssue[];
} {
  const issues: FastenerIssue[] = [];
  const fasteners: SceneFastener[] = [];
  const edges: Array<[string, string]> = [];
  const componentById = new Map(document.components.map((component) => [component.id, component]));
  const ctx: ResolveContext = { componentById };

  for (const [cIndex, component] of document.components.entries()) {
    for (const [fIndex, fastener] of component.fasteners.entries()) {
      const resolved = resolveOne(
        fastener,
        ["components", cIndex, "fasteners", fIndex],
        `${component.id}/fastener#${fIndex}`,
        ctx,
        issues,
      );
      if (!resolved) continue;
      fasteners.push(resolved.scene);
      edges.push(...cliqueEdges(resolved.memberKeys));
    }
  }

  for (const [fIndex, fastener] of document.fasteners.entries()) {
    const resolved = resolveOne(fastener, ["fasteners", fIndex], `fastener#${fIndex}`, ctx, issues);
    if (!resolved) continue;
    fasteners.push(resolved.scene);
    edges.push(...cliqueEdges(resolved.memberKeys));
  }

  return { fasteners, edges, issues };
}
