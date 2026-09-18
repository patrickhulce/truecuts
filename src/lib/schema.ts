import { z } from "zod";
import { getCatalogPart, getFastenerSubtype } from "./catalog";
import { assignIds, isValidId } from "./identity";
import { parseAt, parseDimension, type DimensionInput } from "./units";

export type Axis = 0 | 1 | 2;
export type CutSide = "end" | "start";

const AxisSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const DimensionSchema = z.union([z.number(), z.string()]);
const Vec3InputSchema = z.array(DimensionSchema).length(3);

const CutSchema = z
  .object({
    axis: AxisSchema,
    angle: z.number(),
    at: z.union([DimensionSchema, z.tuple([DimensionSchema, DimensionSchema])]),
    side: z.enum(["end", "start"]).optional(),
    around: AxisSchema.optional(),
  })
  .superRefine((cut, ctx) => {
    const square = Math.abs(cut.angle - 90) < 1e-6;
    const ranged = Array.isArray(cut.at);
    if (square && ranged) {
      ctx.addIssue({
        code: "custom",
        message: "Square cuts (angle 90) take a single `at` position, not a short/long range",
        path: ["at"],
      });
    }
    if (!square && !ranged) {
      ctx.addIssue({
        code: "custom",
        message: "Angled cuts require `at` as [short, long] points",
        path: ["at"],
      });
    }
  });

const PartSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  stock: z.string().min(1),
  cuts: z.array(CutSchema).optional(),
});

const PlacementSchema = z.object({
  part: z.string().min(1),
  position: Vec3InputSchema.optional(),
  rotation: Vec3InputSchema.optional(),
});

const FastenerMemberSchema = z.object({
  component: z.string().min(1).optional(),
  part: z.string().min(1),
  index: z.number().int().nonnegative().optional(),
  at: Vec3InputSchema,
  direction: Vec3InputSchema.optional(),
});

const FastenerSchema = z.object({
  stock: z.string().min(1),
  members: z.array(FastenerMemberSchema).min(2),
});

const ComponentSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  parts: z.array(PlacementSchema).default([]),
  fasteners: z.array(FastenerSchema).default([]),
  position: Vec3InputSchema.optional(),
  rotation: Vec3InputSchema.optional(),
});

export const DocumentSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  parts: z.array(PartSchema).default([]),
  components: z.array(ComponentSchema).default([]),
  fasteners: z.array(FastenerSchema).default([]),
});

export type RawDocument = z.infer<typeof DocumentSchema>;
export type RawCut = z.infer<typeof CutSchema>;
export type RawPart = z.infer<typeof PartSchema>;
export type RawComponent = z.infer<typeof ComponentSchema>;
export type RawPlacement = z.infer<typeof PlacementSchema>;
export type RawFastener = z.infer<typeof FastenerSchema>;
export type RawFastenerMember = z.infer<typeof FastenerMemberSchema>;

export type ResolvedCut = {
  axis: Axis;
  angle: number;
  at: number | [number, number];
  side: CutSide;
  around?: Axis;
};

export type ResolvedPart = {
  id: string;
  label: string;
  stock: string;
  cuts: ResolvedCut[];
};

export type ResolvedPlacement = {
  part: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

export type ResolvedFastenerMember = {
  component: string;
  part: string;
  index: number;
  at: [number, number, number];
  direction?: [number, number, number];
};

export type ResolvedFastener = {
  stock: string;
  members: ResolvedFastenerMember[];
};

export type ResolvedComponent = {
  id: string;
  label: string;
  parts: ResolvedPlacement[];
  fasteners: ResolvedFastener[];
  position: [number, number, number];
  rotation: [number, number, number];
};

export type ResolvedDocument = {
  version: 1;
  name: string;
  parts: ResolvedPart[];
  components: ResolvedComponent[];
  fasteners: ResolvedFastener[];
};

export type ValidationIssue = {
  message: string;
  path: Array<string | number>;
};

function parseVec3(
  input: DimensionInput[] | undefined,
  fallback: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  if (!input) return fallback;
  return [parseDimension(input[0]), parseDimension(input[1]), parseDimension(input[2])];
}

function resolveCut(cut: RawCut): ResolvedCut {
  const at = parseAt(cut.at);
  if (Array.isArray(at) && !(at[0] < at[1])) {
    throw new Error("Angled cut short point must be less than long point");
  }
  return {
    axis: cut.axis,
    angle: cut.angle,
    at,
    side: cut.side ?? "end",
    around: cut.around,
  };
}

function vecLength(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function occurrenceCount(placements: { part: string }[], partId: string): number {
  return placements.filter((placement) => placement.part === partId).length;
}

function resolveFastener(
  raw: RawFastener,
  path: Array<string | number>,
  options: {
    impliedComponentId?: string;
    requireComponent: boolean;
    partIds: Set<string>;
    componentById: Map<string, { id: string; parts: { part: string }[] }>;
  },
  issues: ValidationIssue[],
): ResolvedFastener | undefined {
  const catalog = getCatalogPart(raw.stock);
  const subtype = getFastenerSubtype(raw.stock);
  if (!catalog || catalog.kind !== "fastener" || !subtype) {
    issues.push({
      message: `Unknown fastener stock "${raw.stock}". Fasteners must use a catalog id of kind fastener.`,
      path: [...path, "stock"],
    });
    return undefined;
  }

  if (subtype === "screw") {
    if (raw.members.length !== 2) {
      issues.push({
        message: `Screws require exactly two members, got ${raw.members.length}`,
        path: [...path, "members"],
      });
      return undefined;
    }
  }

  const members: ResolvedFastenerMember[] = [];
  for (const [mIndex, member] of raw.members.entries()) {
    const memberPath = [...path, "members", mIndex];
    if (options.requireComponent) {
      if (!member.component) {
        issues.push({
          message: "Document-level fastener members must include `component`",
          path: [...memberPath, "component"],
        });
        continue;
      }
    } else if (member.component) {
      issues.push({
        message: "Component-level fastener members must not include `component` (it is implied)",
        path: [...memberPath, "component"],
      });
      continue;
    }

    const componentId = options.requireComponent ? member.component : options.impliedComponentId;
    if (!componentId) {
      issues.push({
        message: "Fastener member is missing a component",
        path: memberPath,
      });
      continue;
    }

    const component = options.componentById.get(componentId);
    if (!component) {
      issues.push({
        message: `Unknown component "${componentId}"`,
        path: [...memberPath, "component"],
      });
      continue;
    }

    if (!options.partIds.has(member.part)) {
      issues.push({
        message: `Unknown part "${member.part}". Fastener members reference part ids, not labels.`,
        path: [...memberPath, "part"],
      });
      continue;
    }

    const placed = occurrenceCount(component.parts, member.part);
    if (placed === 0) {
      issues.push({
        message: `Part "${member.part}" is not placed in component "${componentId}"`,
        path: [...memberPath, "part"],
      });
      continue;
    }

    const index = member.index ?? 0;
    if (index >= placed) {
      issues.push({
        message: `Placement index ${index} is out of range for part "${member.part}" in "${componentId}" (${placed} placement${placed === 1 ? "" : "s"})`,
        path: [...memberPath, "index"],
      });
      continue;
    }

    let at: [number, number, number];
    let direction: [number, number, number] | undefined;
    try {
      at = parseVec3(member.at);
      direction = member.direction ? parseVec3(member.direction) : undefined;
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: memberPath,
      });
      continue;
    }

    if (subtype === "screw") {
      if (!direction) {
        issues.push({
          message: "Screw members require `direction` (part-local, head → tip)",
          path: [...memberPath, "direction"],
        });
        continue;
      }
      if (vecLength(direction) < 1e-8) {
        issues.push({
          message: "Screw `direction` must be a non-zero vector",
          path: [...memberPath, "direction"],
        });
        continue;
      }
    } else if (direction && vecLength(direction) < 1e-8) {
      issues.push({
        message: "Fastener `direction` must be a non-zero vector when provided",
        path: [...memberPath, "direction"],
      });
      continue;
    }

    members.push({
      component: componentId,
      part: member.part,
      index,
      at,
      direction,
    });
  }

  if (members.length !== raw.members.length) {
    return undefined;
  }

  return { stock: raw.stock, members };
}

/**
 * Structural + identity validation. Catalog/stock bounds are checked in the scene builder.
 */
export function validateDocument(input: unknown): {
  document?: ResolvedDocument;
  issues: ValidationIssue[];
} {
  const parsed = DocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"),
      })),
    };
  }

  const issues: ValidationIssue[] = [];
  const raw = parsed.data;

  for (const [index, part] of raw.parts.entries()) {
    if (part.id !== undefined && !isValidId(part.id)) {
      issues.push({
        message: `Invalid id "${part.id}". Ids must be lower-kebab-case with a numeric suffix, e.g. leg-1.`,
        path: ["parts", index, "id"],
      });
    }
  }
  for (const [index, component] of raw.components.entries()) {
    if (component.id !== undefined && !isValidId(component.id)) {
      issues.push({
        message: `Invalid id "${component.id}". Ids must be lower-kebab-case with a numeric suffix, e.g. horse-1.`,
        path: ["components", index, "id"],
      });
    }
  }
  if (issues.length > 0) {
    return { issues };
  }

  let identifiedParts: (RawPart & { id: string })[];
  let identifiedComponents: (RawComponent & { id: string })[];
  try {
    const assigned = assignIds([...raw.parts, ...raw.components]);
    identifiedParts = assigned.slice(0, raw.parts.length) as (RawPart & { id: string })[];
    identifiedComponents = assigned.slice(raw.parts.length) as (RawComponent & { id: string })[];
  } catch (error) {
    issues.push({
      message: error instanceof Error ? error.message : String(error),
      path: ["parts"],
    });
    return { issues };
  }

  const partIds = new Set(identifiedParts.map((part) => part.id));
  const componentById = new Map(identifiedComponents.map((component) => [component.id, component]));

  const parts: ResolvedPart[] = [];
  for (const [index, part] of identifiedParts.entries()) {
    try {
      parts.push({
        id: part.id,
        label: part.label,
        stock: part.stock,
        cuts: (part.cuts ?? []).map(resolveCut),
      });
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: ["parts", index, "cuts"],
      });
    }
  }

  const components: ResolvedComponent[] = [];
  for (const [cIndex, component] of identifiedComponents.entries()) {
    const placements: ResolvedPlacement[] = [];
    for (const [pIndex, placement] of component.parts.entries()) {
      if (!partIds.has(placement.part)) {
        issues.push({
          message: `Unknown part "${placement.part}". Component placements reference part ids, not labels.`,
          path: ["components", cIndex, "parts", pIndex, "part"],
        });
        continue;
      }
      try {
        placements.push({
          part: placement.part,
          position: parseVec3(placement.position),
          rotation: parseVec3(placement.rotation),
        });
      } catch (error) {
        issues.push({
          message: error instanceof Error ? error.message : String(error),
          path: ["components", cIndex, "parts", pIndex],
        });
      }
    }

    const fasteners: ResolvedFastener[] = [];
    for (const [fIndex, fastener] of component.fasteners.entries()) {
      const resolved = resolveFastener(
        fastener,
        ["components", cIndex, "fasteners", fIndex],
        {
          impliedComponentId: component.id,
          requireComponent: false,
          partIds,
          componentById,
        },
        issues,
      );
      if (resolved) fasteners.push(resolved);
    }

    try {
      components.push({
        id: component.id,
        label: component.label,
        parts: placements,
        fasteners,
        position: parseVec3(component.position),
        rotation: parseVec3(component.rotation),
      });
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: ["components", cIndex],
      });
    }
  }

  const fasteners: ResolvedFastener[] = [];
  for (const [fIndex, fastener] of raw.fasteners.entries()) {
    const resolved = resolveFastener(
      fastener,
      ["fasteners", fIndex],
      {
        requireComponent: true,
        partIds,
        componentById,
      },
      issues,
    );
    if (resolved) fasteners.push(resolved);
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    document: {
      version: 1,
      name: raw.name,
      parts,
      components,
      fasteners,
    },
    issues,
  };
}
