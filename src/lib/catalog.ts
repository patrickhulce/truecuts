export type Vec3 = [number, number, number];

export type CatalogKind = "lumber" | "sheet" | "hardware" | "fastener";

export type FastenerSubtype = "screw" | "glue" | "bolt" | "nail" | "connector";

export type StockGeometry = "box" | "bracket-l" | "bracket-flat-l" | "connector-t" | "saddle" | "rod";

export type AxisName = "L" | "W" | "T";

/** One axis of a parameterized part. A fixed axis cannot be overridden. */
export type AxisSpec = { fixed: number } | { min: number; max: number; default: number };

export type CatalogPart = {
  id: string;
  kind: CatalogKind;
  label: string;
  subtype?: string;
  /**
   * Actual size in inches, longest → shortest: [L (axis 0, +X), W (axis 1, +Z), T (axis 2, +Y)].
   * Trade names stay (a 2×4 is still a 2×4); numeric dimensions are always L×W×T.
   * For parameterized stock this is the default, matching `axes`.
   */
  size: Vec3;
  /** Nominal trade sizes (thickness × width × length), distinct from actual L×W×T. */
  nominal?: { thickness: number; width: number; length?: number };
  /** Solid builder. Omitted stock is a box. */
  geometry?: StockGeometry;
  /**
   * Present on parameterized stock. Each axis varies on its own: a fixed axis
   * (gauge, for example) stays put when a free axis changes.
   */
  axes?: { L: AxisSpec; W: AxisSpec; T: AxisSpec };
  /** Feature sizes the solid uses that are not L, W, or T. Each is its own spec. */
  features?: Record<string, AxisSpec>;
  material: string;
  color: string;
  notes?: string;
  /** When false, the part is catalogued but not rendered as a solid in v1. */
  renderable: boolean;
};

const PINE = "#c4a36a";
const PLYWOOD = "#d2b48c";
const MDF = "#cbb892";
const STEEL = "#8a9096";
const BLACK = "#3a3a3a";
const ALUMINUM = "#c5ccd1";
const GLUE = "#e6c35c";

const BOLT_FRACTION: Record<number, { id: string; label: string }> = {
  0.25: { id: "1/4", label: "¼" },
  0.375: { id: "3/8", label: "⅜" },
  0.5: { id: "1/2", label: "½" },
};

function hexBolt(diameter: number, length: number): CatalogPart {
  const fraction = BOLT_FRACTION[diameter];
  return {
    id: `bolt-hex-${fraction.id}x${length}`,
    kind: "fastener",
    label: `${fraction.label}″ × ${length}″ hex bolt`,
    subtype: "bolt",
    size: [length, diameter, diameter],
    material: "steel",
    color: STEEL,
    notes: "Rendered as a fastener: hex head, washer, shank, washer, and nut. Length and diameter are independent.",
    renderable: false,
  };
}

function commonNail(penny: number, length: number, diameter: number): CatalogPart {
  const lengthLabel = length === 2.5 ? "2½" : length === 3.5 ? "3½" : String(length);
  return {
    id: `nail-common-${penny}x${length}`,
    kind: "fastener",
    label: `${penny}d × ${lengthLabel}″ common nail`,
    subtype: "nail",
    size: [length, diameter, diameter],
    material: "steel",
    color: STEEL,
    notes: "Rendered as a fastener. Driven through the thinner member from the face opposite the joint.",
    renderable: false,
  };
}

function metalRod(length: number): CatalogPart {
  return {
    id: `rod-1x${length}`,
    kind: "hardware",
    label: `${length}″ × 1″ black round rod`,
    subtype: "rod",
    geometry: "rod",
    size: [length, 1, 1],
    material: "steel",
    color: BLACK,
    notes: "Round bar, 1″ diameter. A longer rod is not a thicker rod. Takes the same planar cuts as lumber.",
    renderable: true,
  };
}

export const CATALOG: CatalogPart[] = [
  {
    id: "2x4x8",
    kind: "lumber",
    label: "2×4 × 8′",
    size: [96, 3.5, 1.5],
    nominal: { thickness: 2, width: 4, length: 96 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 8′ × 3.5″ × 1.5″ (L×W×T).",
    renderable: true,
  },
  {
    id: "2x4x10",
    kind: "lumber",
    label: "2×4 × 10′",
    size: [120, 3.5, 1.5],
    nominal: { thickness: 2, width: 4, length: 120 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 10′ × 3.5″ × 1.5″ (L×W×T).",
    renderable: true,
  },
  {
    id: "2x6x8",
    kind: "lumber",
    label: "2×6 × 8′",
    size: [96, 5.5, 1.5],
    nominal: { thickness: 2, width: 6, length: 96 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 8′ × 5.5″ × 1.5″ (L×W×T). Thickness stays 1.5″.",
    renderable: true,
  },
  {
    id: "2x6x10",
    kind: "lumber",
    label: "2×6 × 10′",
    size: [120, 5.5, 1.5],
    nominal: { thickness: 2, width: 6, length: 120 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 10′ × 5.5″ × 1.5″ (L×W×T). Thickness stays 1.5″.",
    renderable: true,
  },
  {
    id: "2x6x12",
    kind: "lumber",
    label: "2×6 × 12′",
    size: [144, 5.5, 1.5],
    nominal: { thickness: 2, width: 6, length: 144 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 12′ × 5.5″ × 1.5″ (L×W×T). Thickness stays 1.5″.",
    renderable: true,
  },
  {
    id: "6x6x8",
    kind: "lumber",
    label: "6×6 × 8′",
    size: [96, 5.5, 5.5],
    nominal: { thickness: 6, width: 6, length: 96 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 8′ × 5.5″ × 5.5″ (L×W×T).",
    renderable: true,
  },
  {
    id: "6x6x10",
    kind: "lumber",
    label: "6×6 × 10′",
    size: [120, 5.5, 5.5],
    nominal: { thickness: 6, width: 6, length: 120 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 10′ × 5.5″ × 5.5″ (L×W×T).",
    renderable: true,
  },
  {
    id: "6x6x12",
    kind: "lumber",
    label: "6×6 × 12′",
    size: [144, 5.5, 5.5],
    nominal: { thickness: 6, width: 6, length: 144 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 12′ × 5.5″ × 5.5″ (L×W×T).",
    renderable: true,
  },
  {
    id: "plywood-1/4-4x8",
    kind: "sheet",
    label: "¼″ plywood 4×8",
    size: [96, 48, 0.25],
    nominal: { thickness: 0.25, width: 48, length: 96 },
    material: "plywood",
    color: PLYWOOD,
    renderable: true,
  },
  {
    id: "plywood-3/8-4x8",
    kind: "sheet",
    label: "⅜″ plywood 4×8",
    size: [96, 48, 0.375],
    nominal: { thickness: 0.375, width: 48, length: 96 },
    material: "plywood",
    color: PLYWOOD,
    renderable: true,
  },
  {
    id: "plywood-1/2-4x8",
    kind: "sheet",
    label: "½″ plywood 4×8",
    size: [96, 48, 0.5],
    nominal: { thickness: 0.5, width: 48, length: 96 },
    material: "plywood",
    color: PLYWOOD,
    renderable: true,
  },
  {
    id: "plywood-5/8-4x8",
    kind: "sheet",
    label: "⅝″ plywood 4×8",
    size: [96, 48, 0.625],
    nominal: { thickness: 0.625, width: 48, length: 96 },
    material: "plywood",
    color: PLYWOOD,
    renderable: true,
  },
  {
    id: "plywood-3/4-4x8",
    kind: "sheet",
    label: "¾″ plywood 4×8",
    size: [96, 48, 0.75],
    nominal: { thickness: 0.75, width: 48, length: 96 },
    material: "plywood",
    color: PLYWOOD,
    renderable: true,
  },
  {
    id: "mdf-1/4-4x8",
    kind: "sheet",
    label: "¼″ MDF 4×8",
    size: [96, 48, 0.25],
    nominal: { thickness: 0.25, width: 48, length: 96 },
    material: "mdf",
    color: MDF,
    renderable: true,
  },
  {
    id: "mdf-1/2-4x8",
    kind: "sheet",
    label: "½″ MDF 4×8",
    size: [96, 48, 0.5],
    nominal: { thickness: 0.5, width: 48, length: 96 },
    material: "mdf",
    color: MDF,
    renderable: true,
  },
  {
    id: "mdf-3/4-4x8",
    kind: "sheet",
    label: "¾″ MDF 4×8",
    size: [96, 48, 0.75],
    nominal: { thickness: 0.75, width: 48, length: 96 },
    material: "mdf",
    color: MDF,
    renderable: true,
  },
  {
    id: "screw-wood-6x1.25",
    kind: "fastener",
    label: "#6 × 1¼″ wood screw",
    subtype: "screw",
    size: [1.25, 0.138, 0.138],
    material: "steel",
    color: STEEL,
    notes: "Rendered as a fastener instance; not valid as part stock.",
    renderable: false,
  },
  {
    id: "screw-wood-8x1.25",
    kind: "fastener",
    label: "#8 × 1¼″ wood screw",
    subtype: "screw",
    size: [1.25, 0.164, 0.164],
    material: "steel",
    color: STEEL,
    notes: "Rendered as a fastener instance; not valid as part stock.",
    renderable: false,
  },
  {
    id: "screw-wood-8x2",
    kind: "fastener",
    label: "#8 × 2″ wood screw",
    subtype: "screw",
    size: [2, 0.164, 0.164],
    material: "steel",
    color: STEEL,
    notes: "Rendered as a fastener instance; not valid as part stock.",
    renderable: false,
  },
  {
    id: "screw-wood-8x2.5",
    kind: "fastener",
    label: "#8 × 2½″ wood screw",
    subtype: "screw",
    size: [2.5, 0.164, 0.164],
    material: "steel",
    color: STEEL,
    notes: "Rendered as a fastener instance; not valid as part stock.",
    renderable: false,
  },
  {
    id: "screw-wood-10x3",
    kind: "fastener",
    label: "#10 × 3″ wood screw",
    subtype: "screw",
    size: [3, 0.19, 0.19],
    material: "steel",
    color: STEEL,
    notes: "Rendered as a fastener instance; not valid as part stock.",
    renderable: false,
  },
  ...[
    [6, 2, 0.113],
    [8, 2.5, 0.131],
    [10, 3, 0.148],
    [16, 3.5, 0.162],
  ].map(([penny, length, diameter]) => commonNail(penny, length, diameter)),
  {
    id: "wood-glue",
    kind: "fastener",
    label: "Wood glue",
    subtype: "glue",
    size: [0.5, 0.5, 0.1],
    material: "glue",
    color: GLUE,
    notes: "Adhesive bead. Connects two or more members; direction is optional.",
    renderable: false,
  },
  {
    id: "bracket-l-1.5x1.5",
    kind: "hardware",
    label: "1½″ × 1½″ angle L-bracket",
    subtype: "bracket",
    geometry: "bracket-l",
    size: [1.5, 1.5, 0.125],
    material: "steel",
    color: STEEL,
    notes: "Placed as a part. Fasten with screws through each flange.",
    renderable: true,
  },
  {
    id: "bracket-l-2x2",
    kind: "hardware",
    label: "2″ × 2″ angle L-bracket",
    subtype: "bracket",
    geometry: "bracket-l",
    size: [2, 2, 0.125],
    material: "steel",
    color: STEEL,
    notes: "Placed as a part. Fasten with screws through each flange.",
    renderable: true,
  },
  {
    id: "bracket-flat-l-2x1",
    kind: "hardware",
    label: "2″ × 1″ flat L-bracket",
    subtype: "bracket-flat",
    geometry: "bracket-flat-l",
    size: [2, 1, 0.125],
    material: "steel",
    color: STEEL,
    notes: "Single-plane L plate. Placed as a part. Fasten with screws through each leg.",
    renderable: true,
  },
  {
    id: "bracket-flat-l-3x1",
    kind: "hardware",
    label: "3″ × 1″ flat L-bracket",
    subtype: "bracket-flat",
    geometry: "bracket-flat-l",
    size: [3, 1, 0.125],
    material: "steel",
    color: STEEL,
    notes: "Single-plane L plate. Placed as a part. Fasten with screws through each leg.",
    renderable: true,
  },
  {
    id: "bracket-l",
    kind: "hardware",
    label: "Angle L-bracket",
    subtype: "bracket",
    geometry: "bracket-l",
    size: [2, 2, 0.125],
    axes: {
      L: { min: 1.5, max: 12, default: 2 },
      W: { min: 1.5, max: 12, default: 2 },
      T: { fixed: 0.125 },
    },
    material: "steel",
    color: STEEL,
    notes: "Parametric angle L. size is [leg, fold width]; gauge stays 1/8″.",
    renderable: true,
  },
  {
    id: "connector-t",
    kind: "hardware",
    label: "Post-to-beam T-connector",
    subtype: "connector",
    geometry: "connector-t",
    size: [5.5, 5.5, 0.25],
    axes: {
      L: { min: 3.5, max: 12, default: 5.5 },
      W: { min: 3.5, max: 12, default: 5.5 },
      T: { fixed: 0.25 },
    },
    features: { riser: { fixed: 3 } },
    material: "aluminum",
    color: ALUMINUM,
    notes:
      "Connext-style post-to-beam T. size is the timber fit [L, W]; gauge stays 1/4″ and the stem stays 3″ tall. Fits 3.5×3.5 through 12×12, including rectangles such as 5.5×7.5.",
    renderable: true,
  },
  {
    id: "saddle",
    kind: "hardware",
    label: "Post saddle",
    subtype: "saddle",
    geometry: "saddle",
    size: [5.5, 5.5, 0.25],
    axes: {
      L: { min: 1.5, max: 12, default: 5.5 },
      W: { min: 1.5, max: 12, default: 5.5 },
      T: { fixed: 0.25 },
    },
    features: { flange: { fixed: 2 } },
    material: "steel",
    color: STEEL,
    notes: "U-saddle. size is [length along the timber, inside width]; gauge stays 1/4″ and the flanges stay 2″ tall.",
    renderable: true,
  },
  ...[12, 16, 21].map((length) => metalRod(length)),
  ...[2, 3, 4].map((length) => hexBolt(0.25, length)),
  ...[3, 4, 6].map((length) => hexBolt(0.375, length)),
  ...[4, 6, 8].map((length) => hexBolt(0.5, length)),
  {
    id: "hinge-overlay-35mm",
    kind: "hardware",
    label: "35 mm overlay cabinet hinge",
    subtype: "hinge",
    size: [2.75, 2, 0.5],
    material: "steel",
    color: STEEL,
    notes: "Used by the cabinet-door procedural component (v2).",
    renderable: false,
  },
  {
    id: "drawer-slide-18",
    kind: "hardware",
    label: "18″ side-mount drawer slide (pair)",
    subtype: "drawer-slide",
    size: [18, 1.5, 0.5],
    material: "steel",
    color: STEEL,
    notes: "Used by the drawer procedural component (v2).",
    renderable: false,
  },
];

const byId = new Map(CATALOG.map((part) => [part.id, part]));

export function getCatalogPart(id: string): CatalogPart | undefined {
  return byId.get(id);
}

export function listCatalog(kind?: CatalogKind): CatalogPart[] {
  return kind ? CATALOG.filter((part) => part.kind === kind) : CATALOG;
}

export function getFastenerSubtype(id: string): FastenerSubtype | undefined {
  const item = byId.get(id);
  if (!item || item.kind !== "fastener") return undefined;
  if (item.subtype === "screw" || item.subtype === "glue" || item.subtype === "bolt" || item.subtype === "nail") {
    return item.subtype;
  }
  return undefined;
}

/** Lumber whose cross-section fits a post-to-beam T-connector (both shorter sides in the connector's L and W range). */
export function fitsTConnector(part: CatalogPart): boolean {
  if (part.kind !== "lumber") return false;
  const axes = byId.get("connector-t")?.axes;
  if (!axes || !("min" in axes.L) || !("min" in axes.W)) return false;
  const low = Math.max(axes.L.min, axes.W.min);
  const high = Math.min(axes.L.max, axes.W.max);
  const inRange = (value: number) => value >= low - 1e-6 && value <= high + 1e-6;
  return inRange(part.size[1]) && inRange(part.size[2]);
}

export function isLBracket(part: CatalogPart): boolean {
  return part.subtype === "bracket";
}

export function isFlatLBracket(part: CatalogPart): boolean {
  return part.subtype === "bracket-flat";
}

export function isFixedAxis(spec: AxisSpec): spec is { fixed: number } {
  return "fixed" in spec;
}

export function stockGeometry(part: CatalogPart): StockGeometry {
  if (part.geometry) return part.geometry;
  if (isLBracket(part)) return "bracket-l";
  if (isFlatLBracket(part)) return "bracket-flat-l";
  return "box";
}

const AXIS_NAMES: AxisName[] = ["L", "W", "T"];

function axisValue(spec: AxisSpec): number {
  return isFixedAxis(spec) ? spec.fixed : spec.default;
}

function defaultSize(part: CatalogPart): Vec3 {
  if (!part.axes) return [part.size[0], part.size[1], part.size[2]];
  return AXIS_NAMES.map((axis) => axisValue(part.axes![axis])) as Vec3;
}

function resolveFeatures(part: CatalogPart): Record<string, number> {
  const features: Record<string, number> = {};
  for (const [name, spec] of Object.entries(part.features ?? {})) {
    features[name] = axisValue(spec);
  }
  return features;
}

/**
 * Resolve a member size override. Omitted values fill from each free axis's
 * default. Fixed axes stay at their catalog value. An override on stock that
 * is not parameterized, an extra value (which would set a fixed axis), or a
 * value outside min/max is rejected.
 */
export function resolveStockSize(
  part: CatalogPart,
  override?: number[],
): { size: Vec3; features: Record<string, number> } {
  const features = resolveFeatures(part);
  if (!override || override.length === 0) {
    return { size: defaultSize(part), features };
  }
  if (!part.axes) {
    throw new Error(`Stock "${part.id}" is not parameterized; remove size`);
  }
  const free = AXIS_NAMES.filter((axis) => !isFixedAxis(part.axes![axis]));
  if (override.length > free.length) {
    const locked = AXIS_NAMES.filter((axis) => isFixedAxis(part.axes![axis]));
    const lockedText = locked.length === 0 ? "no further axes" : `${locked.join(", ")} ${locked.length === 1 ? "is" : "are"} fixed`;
    throw new Error(
      `Stock "${part.id}" only accepts ${free.length} size value${free.length === 1 ? "" : "s"} (${free.join(", ")}); ${lockedText}`,
    );
  }
  const size = defaultSize(part);
  for (const [index, value] of override.entries()) {
    const axis = free[index];
    const spec = part.axes[axis];
    if (isFixedAxis(spec)) continue;
    if (value < spec.min - 1e-6 || value > spec.max + 1e-6) {
      throw new Error(`Stock "${part.id}" ${axis} must be between ${spec.min} and ${spec.max}, got ${value}`);
    }
    size[AXIS_NAMES.indexOf(axis)] = value;
  }
  return { size, features };
}
