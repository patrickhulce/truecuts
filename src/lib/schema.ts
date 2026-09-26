import { z } from "zod";
import { getCatalogPart, getFastenerSubtype, resolveStockSize, type Vec3 } from "./catalog";
import { FACE_IDS, placeBore, type FaceId, type PlacedBore } from "./geometry/faces";
import { assignIds, isValidId } from "./identity";
import { parseAt, parseDimension, type DimensionInput } from "./units";

export type Axis = 0 | 1 | 2;
export type CutSide = "end" | "start";
export type ScrewJustify = "space-between" | "space-around";

const AxisSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const DimensionSchema = z.union([z.number(), z.string()]);
const Vec3InputSchema = z.array(DimensionSchema).length(3);
const JustifySchema = z.enum(["space-between", "space-around"]);

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

const BoreSchema = z.object({
  face: z.enum(FACE_IDS),
  at: z.tuple([DimensionSchema, DimensionSchema]),
  diameter: DimensionSchema,
  depth: DimensionSchema.optional(),
});

const MemberSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  stock: z.string().min(1),
  /** Free axes of parameterized stock, in L, W, T order. Fixed axes are omitted. */
  size: z.array(DimensionSchema).min(1).max(3).optional(),
  cuts: z.array(CutSchema).optional(),
  bores: z.array(BoreSchema).default([]),
});

const PlacementSchema = z.object({
  id: z.string().min(1),
  position: Vec3InputSchema.optional(),
  rotation: Vec3InputSchema.optional(),
});

const ExplicitMemberSchema = z.object({
  component: z.string().min(1).optional(),
  id: z.string().min(1),
  index: z.number().int().nonnegative().optional(),
  at: Vec3InputSchema,
  direction: Vec3InputSchema.optional(),
});

const ExplicitFastenerSchema = z.object({
  stock: z.string().min(1),
  members: z.array(ExplicitMemberSchema).min(2),
});

const ConnectionMemberSchema = z.object({
  component: z.string().min(1).optional(),
  id: z.string().min(1),
  index: z.number().int().nonnegative().optional(),
});

const ScrewVariantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("four-corners"), edge: DimensionSchema }),
  z.object({ kind: z.literal("angle-bracket"), bracket: z.string().min(1), edge: DimensionSchema }),
  z.object({
    kind: z.literal("perimeter"),
    edge: DimensionSchema,
    separation: DimensionSchema,
    justify: JustifySchema,
  }),
  z.object({
    kind: z.literal("centered"),
    separation: DimensionSchema,
    justify: JustifySchema,
  }),
]);

const GlueVariantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("patch") }),
  z.object({ kind: z.literal("edge"), edge: DimensionSchema }),
]);

const NailVariantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("four-corners"), edge: DimensionSchema }),
  z.object({
    kind: z.literal("perimeter"),
    edge: DimensionSchema,
    separation: DimensionSchema,
    justify: JustifySchema,
  }),
  z.object({
    kind: z.literal("centered"),
    separation: DimensionSchema,
    justify: JustifySchema,
  }),
]);

const BoltVariantSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("through"),
    at: z.tuple([DimensionSchema, DimensionSchema]).optional(),
  }),
  z.object({
    kind: z.literal("angle-bracket"),
    bracket: z.string().min(1),
    edge: DimensionSchema,
  }),
]);

const ConnectionFastenerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("screw"), stock: z.string().min(1), variant: ScrewVariantSchema }),
  z.object({ kind: z.literal("nail"), stock: z.string().min(1), variant: NailVariantSchema }),
  z.object({ kind: z.literal("glue"), stock: z.string().min(1), variant: GlueVariantSchema.optional() }),
  z.object({ kind: z.literal("bolt"), stock: z.string().min(1), variant: BoltVariantSchema }),
  z.object({ kind: z.literal("connector"), stock: z.string().min(1) }),
  z.object({ kind: z.literal("none") }),
]);

const ConnectionSchema = z.object({
  members: z.array(ConnectionMemberSchema).min(2),
  fasteners: z.array(ConnectionFastenerSchema).min(1),
});

const ComponentSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  members: z.array(PlacementSchema).default([]),
  fasteners: z.array(ExplicitFastenerSchema).default([]),
  connections: z.array(ConnectionSchema).default([]),
  position: Vec3InputSchema.optional(),
  rotation: Vec3InputSchema.optional(),
});

export const DocumentSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  members: z.array(MemberSchema).default([]),
  components: z.array(ComponentSchema).default([]),
  fasteners: z.array(ExplicitFastenerSchema).default([]),
  connections: z.array(ConnectionSchema).default([]),
});

export type RawDocument = z.infer<typeof DocumentSchema>;
export type RawCut = z.infer<typeof CutSchema>;
export type RawBore = z.infer<typeof BoreSchema>;
export type RawMember = z.infer<typeof MemberSchema>;
export type RawComponent = z.infer<typeof ComponentSchema>;
export type RawPlacement = z.infer<typeof PlacementSchema>;
export type RawFastener = z.infer<typeof ExplicitFastenerSchema>;
export type RawFastenerMember = z.infer<typeof ExplicitMemberSchema>;
export type RawConnection = z.infer<typeof ConnectionSchema>;
export type RawConnectionFastener = z.infer<typeof ConnectionFastenerSchema>;
export type RawConnectionMember = z.infer<typeof ConnectionMemberSchema>;

export type ResolvedCut = {
  axis: Axis;
  angle: number;
  at: number | [number, number];
  side: CutSide;
  around?: Axis;
};

export type ResolvedBore = PlacedBore;

export type ResolvedMember = {
  id: string;
  label: string;
  stock: string;
  /** Actual L×W×T. Catalog default when the member omits `size`. */
  size: Vec3;
  /** Named feature sizes (riser, flange) from the catalog. Empty for a box. */
  features: Record<string, number>;
  cuts: ResolvedCut[];
  bores: ResolvedBore[];
};

export type ResolvedPlacement = {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

export type ResolvedFastenerMember = {
  component: string;
  id: string;
  index: number;
  at: [number, number, number];
  direction?: [number, number, number];
};

export type ResolvedFastener = {
  stock: string;
  members: ResolvedFastenerMember[];
};

export type ResolvedScrewVariant =
  | { kind: "four-corners"; edge: number }
  | { kind: "angle-bracket"; bracket: string; edge: number }
  | { kind: "perimeter"; edge: number; separation: number; justify: ScrewJustify }
  | { kind: "centered"; separation: number; justify: ScrewJustify };

export type ResolvedNailVariant =
  | { kind: "four-corners"; edge: number }
  | { kind: "perimeter"; edge: number; separation: number; justify: ScrewJustify }
  | { kind: "centered"; separation: number; justify: ScrewJustify };

export type ResolvedGlueVariant = { kind: "patch" } | { kind: "edge"; edge: number };

export type ResolvedBoltVariant =
  | { kind: "through"; at?: [number, number] }
  | { kind: "angle-bracket"; bracket: string; edge: number };

export type ResolvedConnectionFastener =
  | { kind: "screw"; stock: string; variant: ResolvedScrewVariant }
  | { kind: "nail"; stock: string; variant: ResolvedNailVariant }
  | { kind: "glue"; stock: string; variant: ResolvedGlueVariant }
  | { kind: "bolt"; stock: string; variant: ResolvedBoltVariant }
  | { kind: "connector"; stock: string }
  | { kind: "none" };

export type ResolvedConnectionMember = {
  component: string;
  id: string;
  index: number;
};

export type ResolvedConnection = {
  members: ResolvedConnectionMember[];
  fasteners: ResolvedConnectionFastener[];
};

export type ResolvedComponent = {
  id: string;
  label: string;
  members: ResolvedPlacement[];
  fasteners: ResolvedFastener[];
  connections: ResolvedConnection[];
  position: [number, number, number];
  rotation: [number, number, number];
};

export type ResolvedDocument = {
  version: 1;
  name: string;
  members: ResolvedMember[];
  components: ResolvedComponent[];
  fasteners: ResolvedFastener[];
  connections: ResolvedConnection[];
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

function resolveMemberBores(
  rawBores: RawBore[],
  size: Vec3,
): { bores: ResolvedBore[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const parsed: { face: FaceId; at: [number, number]; diameter: number; depth?: number }[] = [];
  for (const [bIndex, bore] of rawBores.entries()) {
    try {
      parsed.push({
        face: bore.face,
        at: [parseDimension(bore.at[0]), parseDimension(bore.at[1])],
        diameter: parseDimension(bore.diameter),
        depth: bore.depth === undefined ? undefined : parseDimension(bore.depth),
      });
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: [bIndex],
      });
    }
  }
  if (issues.length > 0) return { bores: [], issues };

  const bores: ResolvedBore[] = [];
  for (const [bIndex, bore] of parsed.entries()) {
    try {
      bores.push(placeBore(bore, size));
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: [bIndex],
      });
    }
  }
  if (issues.length > 0) return { bores: [], issues };
  return { bores, issues: [] };
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

function occurrenceCount(placements: { id: string }[], memberId: string): number {
  return placements.filter((placement) => placement.id === memberId).length;
}

type MemberRefOptions = {
  impliedComponentId?: string;
  requireComponent: boolean;
  memberIds: Set<string>;
  componentById: Map<string, { id: string; members: { id: string }[] }>;
  /** Noun used in error text, e.g. "Fastener" or "Connection". */
  owner: string;
};

function resolveMemberRef(
  member: { component?: string; id: string; index?: number },
  path: Array<string | number>,
  options: MemberRefOptions,
  issues: ValidationIssue[],
): ResolvedConnectionMember | undefined {
  if (options.requireComponent) {
    if (!member.component) {
      issues.push({
        message: `Document-level ${options.owner.toLowerCase()} members must include \`component\``,
        path: [...path, "component"],
      });
      return undefined;
    }
  } else if (member.component) {
    issues.push({
      message: `Component-level ${options.owner.toLowerCase()} members must not include \`component\` (it is implied)`,
      path: [...path, "component"],
    });
    return undefined;
  }

  const componentId = options.requireComponent ? member.component : options.impliedComponentId;
  if (!componentId) {
    issues.push({
      message: `${options.owner} member is missing a component`,
      path,
    });
    return undefined;
  }

  const component = options.componentById.get(componentId);
  if (!component) {
    issues.push({
      message: `Unknown component "${componentId}"`,
      path: [...path, "component"],
    });
    return undefined;
  }

  if (!options.memberIds.has(member.id)) {
    issues.push({
      message: `Unknown member "${member.id}". ${options.owner} members reference member ids, not labels.`,
      path: [...path, "id"],
    });
    return undefined;
  }

  const placed = occurrenceCount(component.members, member.id);
  if (placed === 0) {
    issues.push({
      message: `Member "${member.id}" is not placed in component "${componentId}"`,
      path: [...path, "id"],
    });
    return undefined;
  }

  const index = member.index ?? 0;
  if (index >= placed) {
    issues.push({
      message: `Placement index ${index} is out of range for member "${member.id}" in "${componentId}" (${placed} placement${placed === 1 ? "" : "s"})`,
      path: [...path, "index"],
    });
    return undefined;
  }

  return { component: componentId, id: member.id, index };
}

function parseMeasure(
  input: DimensionInput,
  path: Array<string | number>,
  label: string,
  issues: ValidationIssue[],
  mode: "nonnegative" | "positive",
): number | undefined {
  let value: number;
  try {
    value = parseDimension(input);
  } catch (error) {
    issues.push({
      message: error instanceof Error ? error.message : String(error),
      path,
    });
    return undefined;
  }
  if (mode === "positive" ? !(value > 0) : value < 0) {
    issues.push({
      message: mode === "positive" ? `${label} must be greater than 0` : `${label} must be 0 or greater`,
      path,
    });
    return undefined;
  }
  return value;
}

function resolveExplicitFastener(
  raw: RawFastener,
  path: Array<string | number>,
  options: MemberRefOptions,
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

  const mechanical = subtype === "screw" || subtype === "bolt" || subtype === "nail";
  const plural = subtype === "bolt" ? "Bolts" : subtype === "nail" ? "Nails" : "Screws";
  if (mechanical && raw.members.length !== 2) {
    issues.push({
      message: `${plural} require exactly two members, got ${raw.members.length}`,
      path: [...path, "members"],
    });
    return undefined;
  }

  const members: ResolvedFastenerMember[] = [];
  for (const [mIndex, member] of raw.members.entries()) {
    const memberPath = [...path, "members", mIndex];
    const ref = resolveMemberRef(member, memberPath, options, issues);
    if (!ref) continue;

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

    if (subtype === "screw" || subtype === "bolt" || subtype === "nail") {
      const noun = subtype === "bolt" ? "Bolt" : subtype === "nail" ? "Nail" : "Screw";
      if (!direction) {
        issues.push({
          message: `${noun} members require \`direction\` (member-local, head → tip)`,
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

    members.push({ ...ref, at, direction });
  }

  if (members.length !== raw.members.length) return undefined;
  return { stock: raw.stock, members };
}

function resolveConnectionFastener(
  raw: RawConnectionFastener,
  path: Array<string | number>,
  memberIds: Set<string>,
  issues: ValidationIssue[],
): ResolvedConnectionFastener | undefined {
  if (raw.kind === "none") return { kind: "none" };
  if (raw.kind === "connector") {
    const catalog = getCatalogPart(raw.stock);
    if (!catalog || catalog.geometry !== "connector-t") {
      issues.push({
        message: `Connector stock must be "connector-t"`,
        path: [...path, "stock"],
      });
      return undefined;
    }
    return { kind: "connector", stock: raw.stock };
  }
  const catalog = getCatalogPart(raw.stock);
  const subtype = getFastenerSubtype(raw.stock);
  if (!catalog || catalog.kind !== "fastener" || !subtype) {
    issues.push({
      message: `Unknown fastener stock "${raw.stock}". Fasteners must use a catalog id of kind fastener.`,
      path: [...path, "stock"],
    });
    return undefined;
  }
  if (subtype !== raw.kind) {
    issues.push({
      message: `Stock "${raw.stock}" is a ${subtype}, not a ${raw.kind}.`,
      path: [...path, "stock"],
    });
    return undefined;
  }

  if (raw.kind === "glue") {
    const variant = raw.variant ?? { kind: "patch" as const };
    if (variant.kind === "patch") return { kind: "glue", stock: raw.stock, variant: { kind: "patch" } };
    const edge = parseMeasure(variant.edge, [...path, "variant", "edge"], "edge", issues, "nonnegative");
    if (edge === undefined) return undefined;
    return { kind: "glue", stock: raw.stock, variant: { kind: "edge", edge } };
  }

  if (raw.kind === "bolt") {
    if (raw.variant.kind === "angle-bracket") {
      if (!memberIds.has(raw.variant.bracket)) {
        issues.push({
          message: `angle-bracket bracket "${raw.variant.bracket}" must be one of the connection members`,
          path: [...path, "variant", "bracket"],
        });
        return undefined;
      }
      const edge = parseMeasure(raw.variant.edge, [...path, "variant", "edge"], "edge", issues, "nonnegative");
      if (edge === undefined) return undefined;
      return {
        kind: "bolt",
        stock: raw.stock,
        variant: { kind: "angle-bracket", bracket: raw.variant.bracket, edge },
      };
    }
    let at: [number, number] | undefined;
    if (raw.variant.at) {
      try {
        at = [parseDimension(raw.variant.at[0]), parseDimension(raw.variant.at[1])];
      } catch (error) {
        issues.push({
          message: error instanceof Error ? error.message : String(error),
          path: [...path, "variant", "at"],
        });
        return undefined;
      }
    }
    return { kind: "bolt", stock: raw.stock, variant: { kind: "through", at } };
  }

  if (raw.kind === "nail") {
    const variant = raw.variant;
    if (variant.kind === "four-corners") {
      const edge = parseMeasure(variant.edge, [...path, "variant", "edge"], "edge", issues, "nonnegative");
      if (edge === undefined) return undefined;
      return { kind: "nail", stock: raw.stock, variant: { kind: "four-corners", edge } };
    }
    const edge =
      variant.kind === "perimeter"
        ? parseMeasure(variant.edge, [...path, "variant", "edge"], "edge", issues, "nonnegative")
        : undefined;
    if (variant.kind === "perimeter" && edge === undefined) return undefined;
    const separation = parseMeasure(
      variant.separation,
      [...path, "variant", "separation"],
      "separation",
      issues,
      "positive",
    );
    if (separation === undefined) return undefined;
    if (variant.kind === "perimeter") {
      return {
        kind: "nail",
        stock: raw.stock,
        variant: { kind: "perimeter", edge: edge ?? 0, separation, justify: variant.justify },
      };
    }
    return {
      kind: "nail",
      stock: raw.stock,
      variant: { kind: "centered", separation, justify: variant.justify },
    };
  }

  const variant = raw.variant;
  if (variant.kind === "angle-bracket" && !memberIds.has(variant.bracket)) {
    issues.push({
      message: `angle-bracket bracket "${variant.bracket}" must be one of the connection members`,
      path: [...path, "variant", "bracket"],
    });
    return undefined;
  }

  if (variant.kind === "four-corners" || variant.kind === "angle-bracket") {
    const edge = parseMeasure(variant.edge, [...path, "variant", "edge"], "edge", issues, "nonnegative");
    if (edge === undefined) return undefined;
    if (variant.kind === "four-corners") return { kind: "screw", stock: raw.stock, variant: { kind: "four-corners", edge } };
    return {
      kind: "screw",
      stock: raw.stock,
      variant: { kind: "angle-bracket", bracket: variant.bracket, edge },
    };
  }

  const edge = variant.kind === "perimeter"
    ? parseMeasure(variant.edge, [...path, "variant", "edge"], "edge", issues, "nonnegative")
    : undefined;
  if (variant.kind === "perimeter" && edge === undefined) return undefined;
  const separation = parseMeasure(
    variant.separation,
    [...path, "variant", "separation"],
    "separation",
    issues,
    "positive",
  );
  if (separation === undefined) return undefined;
  if (variant.kind === "perimeter") {
    return {
      kind: "screw",
      stock: raw.stock,
      variant: { kind: "perimeter", edge: edge ?? 0, separation, justify: variant.justify },
    };
  }
  return {
    kind: "screw",
    stock: raw.stock,
    variant: { kind: "centered", separation, justify: variant.justify },
  };
}

function resolveConnection(
  raw: RawConnection,
  path: Array<string | number>,
  options: MemberRefOptions,
  issues: ValidationIssue[],
): ResolvedConnection | undefined {
  const members: ResolvedConnectionMember[] = [];
  for (const [mIndex, member] of raw.members.entries()) {
    const ref = resolveMemberRef(member, [...path, "members", mIndex], options, issues);
    if (ref) members.push(ref);
  }
  if (members.length !== raw.members.length) return undefined;

  const memberIds = new Set(members.map((member) => member.id));
  const fasteners: ResolvedConnectionFastener[] = [];
  for (const [fIndex, fastener] of raw.fasteners.entries()) {
    const resolved = resolveConnectionFastener(fastener, [...path, "fasteners", fIndex], memberIds, issues);
    if (resolved) fasteners.push(resolved);
  }
  if (fasteners.length !== raw.fasteners.length) return undefined;
  return { members, fasteners };
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

  for (const [index, member] of raw.members.entries()) {
    if (member.id !== undefined && !isValidId(member.id)) {
      issues.push({
        message: `Invalid id "${member.id}". Ids must be lower-kebab-case with a numeric suffix, e.g. leg-1.`,
        path: ["members", index, "id"],
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
  if (issues.length > 0) return { issues };

  let identifiedMembers: (RawMember & { id: string })[];
  let identifiedComponents: (RawComponent & { id: string })[];
  try {
    const assigned = assignIds([...raw.members, ...raw.components]);
    identifiedMembers = assigned.slice(0, raw.members.length) as (RawMember & { id: string })[];
    identifiedComponents = assigned.slice(raw.members.length) as (RawComponent & { id: string })[];
  } catch (error) {
    issues.push({
      message: error instanceof Error ? error.message : String(error),
      path: ["members"],
    });
    return { issues };
  }

  const memberIds = new Set(identifiedMembers.map((member) => member.id));
  const componentById = new Map(identifiedComponents.map((component) => [component.id, component]));

  const members: ResolvedMember[] = [];
  for (const [index, member] of identifiedMembers.entries()) {
    let cuts: ResolvedCut[];
    try {
      cuts = (member.cuts ?? []).map(resolveCut);
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: ["members", index, "cuts"],
      });
      continue;
    }

    const catalog = getCatalogPart(member.stock);
    let size: Vec3 = [0, 0, 0];
    let features: Record<string, number> = {};
    if (catalog) {
      try {
        const override = member.size?.map((value) => parseDimension(value));
        const resolved = resolveStockSize(catalog, override);
        size = resolved.size;
        features = resolved.features;
      } catch (error) {
        issues.push({
          message: error instanceof Error ? error.message : String(error),
          path: ["members", index, "size"],
        });
        continue;
      }
    }

    const resolvedBores = catalog ? resolveMemberBores(member.bores, size) : { bores: [], issues: [] };
    for (const issue of resolvedBores.issues) {
      issues.push({
        message: issue.message,
        path: ["members", index, "bores", ...issue.path],
      });
    }
    if (resolvedBores.issues.length > 0) continue;

    members.push({
      id: member.id,
      label: member.label,
      stock: member.stock,
      size,
      features,
      cuts,
      bores: resolvedBores.bores,
    });
  }

  const components: ResolvedComponent[] = [];
  for (const [cIndex, component] of identifiedComponents.entries()) {
    const placements: ResolvedPlacement[] = [];
    for (const [pIndex, placement] of component.members.entries()) {
      if (!memberIds.has(placement.id)) {
        issues.push({
          message: `Unknown member "${placement.id}". Component placements reference member ids, not labels.`,
          path: ["components", cIndex, "members", pIndex, "id"],
        });
        continue;
      }
      try {
        placements.push({
          id: placement.id,
          position: parseVec3(placement.position),
          rotation: parseVec3(placement.rotation),
        });
      } catch (error) {
        issues.push({
          message: error instanceof Error ? error.message : String(error),
          path: ["components", cIndex, "members", pIndex],
        });
      }
    }

    const refOptions = (requireComponent: boolean): MemberRefOptions => ({
      impliedComponentId: requireComponent ? undefined : component.id,
      requireComponent,
      memberIds,
      componentById,
      owner: "Fastener",
    });

    const fasteners: ResolvedFastener[] = [];
    for (const [fIndex, fastener] of component.fasteners.entries()) {
      const resolved = resolveExplicitFastener(
        fastener,
        ["components", cIndex, "fasteners", fIndex],
        refOptions(false),
        issues,
      );
      if (resolved) fasteners.push(resolved);
    }

    const connections: ResolvedConnection[] = [];
    for (const [nIndex, connection] of component.connections.entries()) {
      const resolved = resolveConnection(
        connection,
        ["components", cIndex, "connections", nIndex],
        { ...refOptions(false), owner: "Connection" },
        issues,
      );
      if (resolved) connections.push(resolved);
    }

    try {
      components.push({
        id: component.id,
        label: component.label,
        members: placements,
        fasteners,
        connections,
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

  const docOptions = (owner: string): MemberRefOptions => ({
    requireComponent: true,
    memberIds,
    componentById,
    owner,
  });

  const fasteners: ResolvedFastener[] = [];
  for (const [fIndex, fastener] of raw.fasteners.entries()) {
    const resolved = resolveExplicitFastener(fastener, ["fasteners", fIndex], docOptions("Fastener"), issues);
    if (resolved) fasteners.push(resolved);
  }

  const connections: ResolvedConnection[] = [];
  for (const [nIndex, connection] of raw.connections.entries()) {
    const resolved = resolveConnection(connection, ["connections", nIndex], docOptions("Connection"), issues);
    if (resolved) connections.push(resolved);
  }

  if (issues.length > 0) return { issues };

  return {
    document: {
      version: 1,
      name: raw.name,
      members,
      components,
      fasteners,
      connections,
    },
    issues,
  };
}
