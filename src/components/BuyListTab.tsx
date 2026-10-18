"use client";

import { useMemo, useState } from "react";
import { buildBuyList, type BuyStock } from "@/lib/buy-list";
import type { ResolvedDocument } from "@/lib/schema";
import type { SceneModel } from "@/lib/scene";
import { formatInches } from "@/lib/units";
import { DimensionField } from "./DimensionField";

const COLORS = ["#d97706", "#a3a34c", "#b87950", "#789c96", "#b799c4", "#bdac66"];

export function BuyListTab({ scene, document }: { scene?: SceneModel; document?: ResolvedDocument }) {
  const [kerf, setKerf] = useState(0);
  const plan = useMemo(() => scene ? buildBuyList(scene, kerf, document) : null, [scene, kerf, document]);
  if (!plan) return <p className="p-4 text-sm text-[#a89070]">Fix the document errors to calculate a buy list.</p>;
  const purchases = new Map<string, { label: string; count: number }>();
  for (const bin of plan.stock) {
    const entry = purchases.get(bin.stock.id) ?? { label: bin.stock.label, count: 0 };
    entry.count++;
    purchases.set(bin.stock.id, entry);
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-sm text-[#d6c3a3]">
      <h2 className="font-[family-name:var(--font-display)] text-lg text-[#f59e0b]">Buy list</h2>
      <p className="mt-1 text-xs text-[#a89070]">Quick estimate from every placed part, including linked copies. Uses the stock sizes in the catalog.</p>
      <label className="mt-3 flex items-center gap-3 text-xs">
        <span>Saw kerf</span>
        <DimensionField
          label="Saw kerf"
          value={kerf}
          min={0}
          max={1}
          onCommit={setKerf}
          className="w-24 rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm text-[#d6c3a3]"
        />
      </label>
      <p className="mt-1 text-[11px] text-[#8a7355]">{kerf === 0 ? 'No saw loss included. Enter your blade width (for example 1/8") to allow for it.' : `${formatInches(kerf)} allowed between cuts.`}</p>
      {plan.pieceCount === 0 && plan.items.length === 0 && plan.consumables.length === 0 ? (
        <p className="mt-6 text-[#a89070]">Place some parts in your build to see what to buy.</p>
      ) : (
        <>
          <div className="mt-4 rounded border border-[#3d2a18] bg-[#241a10] p-3">
            <h3 className="text-xs uppercase tracking-widest text-[#a89070]">Shopping list</h3>
            <ul className="mt-2 space-y-2">
              {[...purchases].map(([id, item]) => (
                <li key={id} className="flex items-baseline gap-2">
                  <strong className="text-[#f59e0b]">{item.count} ×</strong>
                  <span>{item.label}</span>
                </li>
              ))}
              {plan.items.map((item) => (
                <li key={item.key} className="flex items-baseline gap-2">
                  <strong className="text-[#f59e0b]">{item.count} ×</strong>
                  <span>{item.label}{item.size ? <span className="block text-xs text-[#a89070]">Configured size: {item.size.map((value) => formatInches(value)).join(" × ")}</span> : null}</span>
                </li>
              ))}
              {plan.consumables.map((label) => <li key={label}>{label} <span className="text-xs text-[#a89070]">· as needed</span></li>)}
            </ul>
          </div>
          {plan.unpacked.length > 0 ? (
            <div role="alert" className="mt-3 rounded border border-amber-700 p-3 text-xs text-amber-300">
              <p>These parts need a manual stock choice:</p>
              <ul className="mt-1 list-inside list-disc">{plan.unpacked.map((message, index) => <li key={index}>{message}</li>)}</ul>
            </div>
          ) : null}
          {plan.stock.length > 0 ? (
            <>
              <h3 className="mt-5 text-xs uppercase tracking-widest text-[#a89070]">Suggested cuts</h3>
              <p className="mt-1 text-[11px] text-[#8a7355]">Quick packing, not a guaranteed optimum. Angled parts use rectangular blanks. Sheets keep grain direction; lumber reserves the full board width. No end-trim allowance.</p>
              <div className="mt-3 space-y-3">
                {plan.stock.map((bin, index) => <StockCuts key={index} bin={bin} index={index} />)}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function StockCuts({ bin, index }: { bin: BuyStock; index: number }) {
  const sheet = bin.stock.kind === "sheet";
  const width = bin.stock.size[0];
  const height = sheet ? bin.stock.size[1] : width / 12;
  const used = bin.cuts.reduce((sum, cut) => sum + cut.length * (sheet ? cut.width : 1), 0);
  const capacity = width * (sheet ? height : 1);
  const cuts = new Map<string, { label: string; size: string; count: number }>();
  for (const cut of bin.cuts) {
    const size = sheet ? `${formatInches(cut.length)} × ${formatInches(cut.width)}` : formatInches(cut.length);
    const key = `${cut.label}:${size}`;
    const item = cuts.get(key) ?? { label: cut.label, size, count: 0 };
    item.count++;
    cuts.set(key, item);
  }
  return (
    <details className="rounded border border-[#3d2a18] bg-[#241a10] p-3" open>
      <summary className="cursor-pointer text-xs text-[#d6c3a3]">#{index + 1} · {bin.stock.label} <span className="text-[#8a7355]">· {Math.round(used / capacity * 100)}% used</span></summary>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cut layout for ${bin.stock.label}`} className="my-2 w-full rounded bg-[#110d08]">
        {bin.cuts.map((cut, n) => (
          <rect key={cut.key} x={cut.x} y={sheet ? cut.y : 0} width={cut.length} height={sheet ? cut.width : height} fill={COLORS[n % COLORS.length]} stroke="#241a10" strokeWidth={0.35}>
            <title>{cut.label}: {formatInches(cut.length)}{sheet ? ` × ${formatInches(cut.width)}` : ""}</title>
          </rect>
        ))}
      </svg>
      <ul className="space-y-1 text-xs text-[#a89070]">
        {[...cuts].map(([key, cut]) => <li key={key}>{cut.count} × {cut.size} <span className="text-[#d6c3a3]">— {cut.label}</span></li>)}
      </ul>
    </details>
  );
}
