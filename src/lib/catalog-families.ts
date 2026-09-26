import {
  getCatalogPart,
  isFixedAxis,
  type AxisName,
  type CatalogKind,
  type CatalogPart,
} from "./catalog";
import { formatInches } from "./units";

const AXIS_NAMES: AxisName[] = ["L", "W", "T"];

export type StockFamily = {
  id: string;
  kind: CatalogKind;
  title: string;
  summary: string;
  /** Catalog ids. The first entry is the default variant. */
  variants: string[];
  defaultLabel: string;
  /** A square crosscut on L is a useful starting cut for this stock. */
  allowsCut: boolean;
};

export const STOCK_FAMILIES: StockFamily[] = [
  {
    id: "lumber-2x4",
    kind: "lumber",
    title: "2×4",
    summary: "Pine lumber · 8′ or 10′",
    variants: ["2x4x8", "2x4x10"],
    defaultLabel: "Board",
    allowsCut: true,
  },
  {
    id: "lumber-2x6",
    kind: "lumber",
    title: "2×6",
    summary: "Pine lumber · 8′, 10′, or 12′",
    variants: ["2x6x8", "2x6x10", "2x6x12"],
    defaultLabel: "Board",
    allowsCut: true,
  },
  {
    id: "lumber-6x6",
    kind: "lumber",
    title: "6×6",
    summary: "Pine timber · 8′, 10′, or 12′",
    variants: ["6x6x8", "6x6x10", "6x6x12"],
    defaultLabel: "Post",
    allowsCut: true,
  },
  {
    id: "plywood-4x8",
    kind: "sheet",
    title: "Plywood 4×8",
    summary: "Sheet · ¼″ through ¾″",
    variants: ["plywood-1/4-4x8", "plywood-3/8-4x8", "plywood-1/2-4x8", "plywood-5/8-4x8", "plywood-3/4-4x8"],
    defaultLabel: "Panel",
    allowsCut: true,
  },
  {
    id: "mdf-4x8",
    kind: "sheet",
    title: "MDF 4×8",
    summary: "Sheet · ¼″, ½″, or ¾″",
    variants: ["mdf-1/4-4x8", "mdf-1/2-4x8", "mdf-3/4-4x8"],
    defaultLabel: "Panel",
    allowsCut: true,
  },
  {
    id: "bracket-angle",
    kind: "hardware",
    title: "Angle L-bracket",
    summary: "Steel · stocked sizes or custom legs",
    variants: ["bracket-l-1.5x1.5", "bracket-l-2x2", "bracket-l"],
    defaultLabel: "Bracket",
    allowsCut: false,
  },
  {
    id: "bracket-flat",
    kind: "hardware",
    title: "Flat L-bracket",
    summary: "Steel plate · 2″ or 3″",
    variants: ["bracket-flat-l-2x1", "bracket-flat-l-3x1"],
    defaultLabel: "Bracket",
    allowsCut: false,
  },
  {
    id: "connector-t",
    kind: "hardware",
    title: "Post T-connector",
    summary: "Aluminum · fit 3½″ through 12″",
    variants: ["connector-t"],
    defaultLabel: "Cap",
    allowsCut: false,
  },
  {
    id: "saddle",
    kind: "hardware",
    title: "Post saddle",
    summary: "Steel · fit 1½″ through 12″",
    variants: ["saddle"],
    defaultLabel: "Saddle",
    allowsCut: false,
  },
  {
    id: "rod",
    kind: "hardware",
    title: "Round rod",
    summary: "1″ black bar · 12″, 16″, or 21″",
    variants: ["rod-1x12", "rod-1x16", "rod-1x21"],
    defaultLabel: "Rod",
    allowsCut: true,
  },
  {
    id: "wood-screw",
    kind: "fastener",
    title: "Wood screw",
    summary: "Used on connections, not as stock",
    variants: ["screw-wood-6x1.25", "screw-wood-8x1.25", "screw-wood-8x2", "screw-wood-8x2.5", "screw-wood-10x3"],
    defaultLabel: "Screw",
    allowsCut: false,
  },
  {
    id: "hex-bolt",
    kind: "fastener",
    title: "Hex bolt",
    summary: "Used on connections, not as stock",
    variants: [
      "bolt-hex-1/4x2",
      "bolt-hex-1/4x3",
      "bolt-hex-1/4x4",
      "bolt-hex-3/8x3",
      "bolt-hex-3/8x4",
      "bolt-hex-3/8x6",
      "bolt-hex-1/2x4",
      "bolt-hex-1/2x6",
      "bolt-hex-1/2x8",
    ],
    defaultLabel: "Bolt",
    allowsCut: false,
  },
  {
    id: "wood-glue",
    kind: "fastener",
    title: "Wood glue",
    summary: "Adhesive bead on a connection",
    variants: ["wood-glue"],
    defaultLabel: "Glue",
    allowsCut: false,
  },
];

export type FreeAxis = {
  axis: AxisName;
  min: number;
  max: number;
  default: number;
};

export function familyParts(family: StockFamily): CatalogPart[] {
  return family.variants.flatMap((id) => {
    const part = getCatalogPart(id);
    return part ? [part] : [];
  });
}

export function variantLabel(part: CatalogPart): string {
  if (part.id === "bracket-l" || part.id === "connector-t" || part.id === "saddle") return "Custom";
  if (part.kind === "lumber" || part.subtype === "rod") return formatInches(part.size[0]);
  if (part.kind === "sheet") return formatInches(part.size[2]);
  if (part.subtype === "screw") return part.label.replace(/ wood screw$/, "");
  if (part.subtype === "bolt") return part.label.replace(/ hex bolt$/, "");
  if (part.subtype === "bracket" || part.subtype === "bracket-flat") {
    return `${formatInches(part.size[0])} × ${formatInches(part.size[1])}`;
  }
  return part.label;
}

export function freeAxes(part: CatalogPart): FreeAxis[] {
  if (!part.axes) return [];
  const axes: FreeAxis[] = [];
  for (const axis of AXIS_NAMES) {
    const spec = part.axes[axis];
    if (!isFixedAxis(spec)) axes.push({ axis, min: spec.min, max: spec.max, default: spec.default });
  }
  return axes;
}

/** Size override for free axes, omitted when every value is still the catalog default. */
export function sizeOverride(part: CatalogPart, values: Partial<Record<AxisName, number>>): number[] | undefined {
  const axes = freeAxes(part);
  if (axes.length === 0) return undefined;
  const nums = axes.map((axis) => values[axis.axis] ?? axis.default);
  const unchanged = axes.every((axis, index) => Math.abs(nums[index] - axis.default) < 1e-6);
  return unchanged ? undefined : nums;
}

export function stockLength(part: CatalogPart, values: Partial<Record<AxisName, number>>): number {
  if (!part.axes) return part.size[0];
  const spec = part.axes.L;
  if (isFixedAxis(spec)) return spec.fixed;
  return values.L ?? spec.default;
}
