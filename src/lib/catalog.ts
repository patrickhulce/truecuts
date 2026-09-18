export type Vec3 = [number, number, number];

export type CatalogKind = "lumber" | "sheet" | "hardware";

export type CatalogPart = {
  id: string;
  kind: CatalogKind;
  label: string;
  subtype?: string;
  /** Actual size in inches: [length (axis 0), width (axis 1), thickness (axis 2)]. */
  size: Vec3;
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

export const CATALOG: CatalogPart[] = [
  {
    id: "2x4x8",
    kind: "lumber",
    label: "2×4 × 8′",
    size: [96, 3.5, 1.5],
    nominal: { thickness: 2, width: 4, length: 96 },
    material: "pine",
    color: PINE,
    notes: "Dimensional lumber. Actual 1.5″ × 3.5″ × 8′.",
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
    notes: "Dimensional lumber. Actual 1.5″ × 3.5″ × 10′.",
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
    id: "screw-wood-8x2.5",
    kind: "hardware",
    label: "#8 × 2½″ wood screw",
    subtype: "screw",
    size: [2.5, 0.164, 0.164],
    material: "steel",
    color: STEEL,
    notes: "Documented in the catalog; hardware is not rendered as solids in v1.",
    renderable: false,
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
    id: "bracket-l-2x2",
    kind: "hardware",
    label: "2″ × 2″ L-bracket",
    subtype: "bracket",
    size: [2, 2, 0.125],
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
    size: [18, 0.5, 1.5],
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
