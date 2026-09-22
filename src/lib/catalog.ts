export type Vec3 = [number, number, number];

export type CatalogKind = "lumber" | "sheet" | "hardware" | "fastener";

export type FastenerSubtype = "screw" | "glue" | "bolt";

export type CatalogPart = {
  id: string;
  kind: CatalogKind;
  label: string;
  subtype?: string;
  /**
   * Actual size in inches, longest → shortest: [L (axis 0, +X), W (axis 1, +Z), T (axis 2, +Y)].
   * Trade names stay (a 2×4 is still a 2×4); numeric dimensions are always L×W×T.
   */
  size: Vec3;
  /** Nominal trade sizes (thickness × width × length), distinct from actual L×W×T. */
  nominal?: { thickness: number; width: number; length?: number };
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
const GLUE = "#e6c35c";

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
    size: [3, 1, 0.125],
    material: "steel",
    color: STEEL,
    notes: "Single-plane L plate. Placed as a part. Fasten with screws through each leg.",
    renderable: true,
  },
  {
    id: "bolt-1/4-20x3",
    kind: "hardware",
    label: "¼-20 × 3″ hex bolt",
    subtype: "bolt",
    size: [3, 0.25, 0.25],
    material: "steel",
    color: STEEL,
    renderable: false,
  },
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
  if (item.subtype === "screw" || item.subtype === "glue" || item.subtype === "bolt") {
    return item.subtype;
  }
  return undefined;
}

export function isLBracket(part: CatalogPart): boolean {
  return part.subtype === "bracket";
}

export function isFlatLBracket(part: CatalogPart): boolean {
  return part.subtype === "bracket-flat";
}
