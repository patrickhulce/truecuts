import { getCatalogPart, listCatalog, type CatalogPart } from "./catalog";
import { sceneMembers, type SceneModel } from "./scene";
import type { ResolvedDocument } from "./schema";

const EPS = 1e-6;

export type BuyCut = { key: string; label: string; length: number; width: number; x: number; y: number };
export type BuyStock = { stock: CatalogPart; cuts: BuyCut[] };
export type BuyItem = { key: string; label: string; count: number; size?: number[] };
export type BuyList = { stock: BuyStock[]; items: BuyItem[]; consumables: string[]; unpacked: string[]; pieceCount: number };

function usedLength(bin: BuyStock, kerf: number): number {
  return bin.cuts.reduce((sum, cut) => sum + cut.length, 0) + Math.max(0, bin.cuts.length - 1) * kerf;
}

/** Best-fit decreasing, trying both mixed lengths and each available fixed length. */
function packBoards(cuts: BuyCut[], options: CatalogPart[], kerf: number): BuyStock[] {
  const sorted = [...cuts].sort((a, b) => b.length - a.length || a.key.localeCompare(b.key));
  function run(stockOptions: CatalogPart[]): BuyStock[] {
    const bins: BuyStock[] = [];
    for (let index = 0; index < sorted.length; index++) {
      const cut = sorted[index];
      let best: BuyStock | undefined;
      let least = Infinity;
      for (const bin of bins) {
        const left = bin.stock.size[0] - usedLength(bin, kerf) - kerf - cut.length;
        if (left >= -EPS && left < least) { best = bin; least = left; }
      }
      if (!best) {
        let chosen = stockOptions[0];
        let bestUse = -1;
        for (const stock of stockOptions) {
          if (stock.size[0] + EPS < cut.length) continue;
          let used = cut.length;
          for (let next = index + 1; next < sorted.length; next++) {
            if (used + kerf + sorted[next].length <= stock.size[0] + EPS) used += kerf + sorted[next].length;
          }
          const use = used / stock.size[0];
          if (use > bestUse + EPS || (Math.abs(use - bestUse) < EPS && stock.size[0] < chosen.size[0])) {
            chosen = stock;
            bestUse = use;
          }
        }
        best = { stock: chosen, cuts: [] };
        bins.push(best);
      }
      const x = best.cuts.length ? usedLength(best, kerf) + kerf : 0;
      best.cuts.push({ ...cut, x });
    }
    return bins;
  }
  const plans = [run(options), ...options.filter((stock) => sorted.every((cut) => cut.length <= stock.size[0] + EPS)).map((stock) => run([stock]))];
  const total = (plan: BuyStock[]) => plan.reduce((sum, bin) => sum + bin.stock.size[0], 0);
  return plans.sort((a, b) => total(a) - total(b) || a.length - b.length)[0];
}

type FreeRect = { x: number; y: number; length: number; width: number };

/** Guillotine rectangle packing. Keep sheet grain direction; do not rotate pieces. */
function packSheets(cuts: BuyCut[], stock: CatalogPart, kerf: number): BuyStock[] {
  const bins: Array<BuyStock & { free: FreeRect[] }> = [];
  for (const cut of [...cuts].sort((a, b) => b.length * b.width - a.length * a.width || b.length - a.length)) {
    let match: { bin: typeof bins[number]; index: number; waste: number } | undefined;
    for (const bin of bins) {
      bin.free.forEach((rect, index) => {
        if (rect.length + EPS < cut.length || rect.width + EPS < cut.width) return;
        const waste = rect.length * rect.width - cut.length * cut.width;
        if (!match || waste < match.waste) match = { bin, index, waste };
      });
    }
    if (!match) {
      const bin = { stock, cuts: [] as BuyCut[], free: [{ x: 0, y: 0, length: stock.size[0], width: stock.size[1] }] };
      bins.push(bin);
      match = { bin, index: 0, waste: 0 };
    }
    const { bin, index } = match;
    const rect = bin.free.splice(index, 1)[0];
    bin.cuts.push({ ...cut, x: rect.x, y: rect.y });
    const right = rect.length - cut.length - kerf;
    const below = rect.width - cut.width - kerf;
    if (right > EPS) bin.free.push({ x: rect.x + cut.length + kerf, y: rect.y, length: right, width: cut.width });
    if (below > EPS) bin.free.push({ x: rect.x, y: rect.y + cut.width + kerf, length: rect.length, width: below });
  }
  return bins.map(({ stock, cuts }) => ({ stock, cuts }));
}

/** Count placed instances, not definitions. Paint never changes the raw stock required. */
export function buildBuyList(scene: SceneModel, kerf = 0, document?: ResolvedDocument): BuyList {
  if (!Number.isFinite(kerf) || kerf < 0) throw new Error("Saw kerf must be a nonnegative number");
  const result: BuyList = { stock: [], items: [], consumables: [], unpacked: [], pieceCount: 0 };
  const groups = new Map<string, { source: CatalogPart; cuts: BuyCut[] }>();
  const items = new Map<string, BuyItem>();
  const consumables = new Set<string>();
  function countItem(stock: CatalogPart, size?: number[]) {
    const key = `${stock.id}:${size?.join(",") ?? ""}`;
    const item = items.get(key) ?? { key, label: stock.label, count: 0, size };
    item.count++;
    items.set(key, item);
  }
  for (const member of sceneMembers(scene.components)) {
    const stock = getCatalogPart(member.stockId);
    if (!stock) { result.unpacked.push(`${member.label}: unknown stock ${member.stockId}`); continue; }
    result.pieceCount++;
    if ((stock.kind !== "lumber" && stock.kind !== "sheet") || stock.axes) {
      const definition = document?.members.find((item) => item.id === member.memberId);
      countItem(stock, stock.axes ? definition?.size ?? stock.size : undefined);
      continue;
    }
    const key = stock.kind === "lumber"
      ? JSON.stringify([stock.kind, stock.material, stock.size[1], stock.size[2], stock.nominal?.width, stock.nominal?.thickness])
      : stock.id;
    const group = groups.get(key) ?? { source: stock, cuts: [] };
    group.cuts.push({ key: member.key, label: member.label, length: member.finished.length, width: member.finished.width, x: 0, y: 0 });
    groups.set(key, group);
  }
  for (const { source, cuts } of groups.values()) {
    const options = source.kind === "lumber" ? listCatalog().filter((part) =>
      part.kind === "lumber" && !part.axes && part.material === source.material &&
      part.size[1] === source.size[1] && part.size[2] === source.size[2] &&
      part.nominal?.width === source.nominal?.width && part.nominal?.thickness === source.nominal?.thickness,
    ).sort((a, b) => a.size[0] - b.size[0]) : [source];
    const fitting = cuts.filter((cut) => {
      const fits = options.some((stock) => cut.length <= stock.size[0] + EPS && cut.width <= stock.size[1] + EPS);
      if (!fits) result.unpacked.push(`${cut.label}: exceeds available ${source.label}`);
      return fits;
    });
    if (fitting.length) result.stock.push(...(source.kind === "lumber" ? packBoards(fitting, options, kerf) : packSheets(fitting, source, kerf)));
  }
  for (const fastener of scene.fasteners) {
    const stock = getCatalogPart(fastener.stockId);
    if (!stock) { result.unpacked.push(`Unknown hardware ${fastener.stockLabel}`); continue; }
    if (fastener.subtype === "glue") consumables.add(stock.label);
    else countItem(stock, stock.axes ? fastener.size : undefined);
  }
  result.items = [...items.values()].sort((a, b) => a.label.localeCompare(b.label));
  result.consumables = [...consumables].sort();
  return result;
}
