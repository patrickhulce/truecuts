import { z } from "zod";
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

const ComponentSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  parts: z.array(PlacementSchema).default([]),
  position: Vec3InputSchema.optional(),
  rotation: Vec3InputSchema.optional(),
});

export const DocumentSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  parts: z.array(PartSchema).default([]),
  components: z.array(ComponentSchema).default([]),
});

export type RawDocument = z.infer<typeof DocumentSchema>;
export type RawCut = z.infer<typeof CutSchema>;
export type RawPart = z.infer<typeof PartSchema>;
export type RawComponent = z.infer<typeof ComponentSchema>;
export type RawPlacement = z.infer<typeof PlacementSchema>;

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

export type ResolvedComponent = {
  id: string;
  label: string;
  parts: ResolvedPlacement[];
  position: [number, number, number];
  rotation: [number, number, number];
};

export type ResolvedDocument = {
  version: 1;
  name: string;
  parts: ResolvedPart[];
  components: ResolvedComponent[];
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
    try {
      components.push({
        id: component.id,
        label: component.label,
        parts: placements,
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

  if (issues.length > 0) {
    return { issues };
  }

  return {
    document: {
      version: 1,
      name: raw.name,
      parts,
      components,
    },
    issues,
  };
}
