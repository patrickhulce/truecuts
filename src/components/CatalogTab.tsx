"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  familyParts,
  freeAxes,
  sizeOverride,
  stockLength,
  STOCK_FAMILIES,
  variantLabel,
  type StockFamily,
} from "@/lib/catalog-families";
import { getCatalogPart, type AxisName, type CatalogKind, type CatalogPart } from "@/lib/catalog";
import { addMember, CATALOG_DRAG_MIME, type MemberCutInput, type NewMemberInput } from "@/lib/edit";
import { formatInches, parseDimension } from "@/lib/units";
import { FastenerIcon } from "./FastenerIcon";
import { CatalogThumbnail } from "./MemberThumbnail";

type CatalogTabProps = {
  text: string;
  onCommit: (value: string) => void;
};

type Filter = "all" | CatalogKind;

type CatalogDraft = {
  familyId: string;
  part: CatalogPart;
  input: NewMemberInput;
  cutAt?: number;
};

function fastenerKind(part: CatalogPart): "screw" | "nail" | "glue" | "bolt" | "bracket" | "connector" {
  if (part.subtype === "nail" || part.subtype === "glue" || part.subtype === "bolt" || part.subtype === "connector") {
    return part.subtype;
  }
  if (part.subtype === "bracket" || part.subtype === "bracket-flat") return "bracket";
  return "screw";
}

function FastenerSwatch({ part }: { part: CatalogPart }) {
  return (
    <div className="pointer-events-none grid h-16 w-16 shrink-0 place-items-center rounded border border-[#3d2a18] bg-[#140e09] text-[#a89070]">
      <FastenerIcon kind={fastenerKind(part)} />
    </div>
  );
}

function CatalogSwatch({
  part,
  size,
  cutAt,
}: {
  part: CatalogPart | undefined;
  size?: number[];
  cutAt?: number;
}) {
  if (!part) return <div className="h-16 w-16 shrink-0 rounded border border-[#3d2a18] bg-[#140e09]" />;
  if (!part.renderable) return <FastenerSwatch part={part} />;
  return <CatalogThumbnail part={part} size={size} cutAt={cutAt} />;
}

function beginCatalogDrag(event: DragEvent, input: NewMemberInput) {
  const payload = JSON.stringify(input);
  event.dataTransfer.setData(CATALOG_DRAG_MIME, payload);
  event.dataTransfer.setData("text/plain", payload);
  event.dataTransfer.effectAllowed = "copy";
}

function dragInput(family: StockFamily, draft: CatalogDraft | null): NewMemberInput {
  if (draft && draft.familyId === family.id) {
    return { ...draft.input, label: draft.input.label.trim() || family.defaultLabel };
  }
  return { label: family.defaultLabel, stock: family.variants[0] ?? "" };
}

function configuredCut(
  family: StockFamily,
  part: CatalogPart,
  axes: Partial<Record<AxisName, number>>,
  cutText: string,
): number | undefined {
  if (!family.allowsCut || !cutText.trim()) return undefined;
  try {
    const at = parseDimension(cutText.trim());
    const length = stockLength(part, axes);
    if (at > 0 && at < length - 1e-6) return at;
  } catch {
    return undefined;
  }
  return undefined;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lumber", label: "Lumber" },
  { id: "sheet", label: "Sheets" },
  { id: "hardware", label: "Hardware" },
  { id: "fastener", label: "Fasteners" },
];

export function CatalogTab({ text, onCommit }: CatalogTabProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const rememberDraft = useCallback((next: CatalogDraft) => {
    setDraft(next);
  }, []);
  const families = STOCK_FAMILIES.filter((family) => filter === "all" || family.kind === filter);
  const selected = STOCK_FAMILIES.find((family) => family.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`min-h-0 overflow-auto ${selected ? "basis-0 flex-1" : "flex-1"}`}>
        <div className="flex flex-wrap gap-1 px-3 pt-3">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] ${
                filter === item.id
                  ? "border-[#f59e0b] text-[#f59e0b]"
                  : "border-[#3d2a18] text-[#a89070] hover:border-[#6b4a2b] hover:text-[#d6c3a3]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          {families.map((family) => {
            const configured = draft?.familyId === family.id ? draft : null;
            const part = configured?.part ?? getCatalogPart(family.variants[0] ?? "");
            const active = family.id === selectedId;
            const placeable = Boolean(part?.renderable);
            return (
              <button
                key={family.id}
                type="button"
                aria-pressed={active}
                draggable={placeable}
                onDragStart={(event) => {
                  if (!part?.renderable) {
                    event.preventDefault();
                    return;
                  }
                  beginCatalogDrag(event, dragInput(family, draft));
                }}
                onClick={() => setSelectedId(family.id)}
                className={`flex items-center gap-2 rounded border p-2 text-left ${
                  placeable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                } ${active ? "border-[#f59e0b]" : "border-[#3d2a18] hover:border-[#6b4a2b]"}`}
              >
                <CatalogSwatch part={part} size={configured?.input.size} cutAt={configured?.cutAt} />
                <span className="min-w-0">
                  <span className="block text-sm text-[#d6c3a3]">{family.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-[#8a7355]">{family.summary}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {selected ? (
        <StockConfig
          key={selected.id}
          family={selected}
          text={text}
          onCommit={onCommit}
          onDraft={rememberDraft}
          onClose={() => {
            setDraft(null);
            setSelectedId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function StockConfig({
  family,
  text,
  onCommit,
  onDraft,
  onClose,
}: {
  family: StockFamily;
  text: string;
  onCommit: (value: string) => void;
  onDraft: (draft: CatalogDraft) => void;
  onClose: () => void;
}) {
  const parts = useMemo(() => familyParts(family), [family]);
  const [variantId, setVariantId] = useState(parts[0]?.id ?? "");
  const part = parts.find((item) => item.id === variantId) ?? parts[0];
  const [label, setLabel] = useState(family.defaultLabel);
  const [axes, setAxes] = useState<Partial<Record<AxisName, number>>>(() => axisDefaults(part));
  const [cutText, setCutText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const cutAt = part ? configuredCut(family, part, axes, cutText) : undefined;
  const previewSize = useMemo(() => (part ? sizeOverride(part, axes) : undefined), [axes, part]);

  useEffect(() => {
    if (!part) return;
    onDraft({
      familyId: family.id,
      part,
      cutAt,
      input: {
        label: label.trim(),
        stock: part.id,
        size: previewSize,
        cuts: cutAt === undefined ? undefined : [{ axis: 0, angle: 90, at: cutAt }],
      },
    });
  }, [cutAt, family.id, label, onDraft, part, previewSize]);

  function chooseVariant(next: CatalogPart) {
    setVariantId(next.id);
    setAxes(axisDefaults(next));
    setError(null);
    setAdded(null);
  }

  function add() {
    if (!part) return;
    setError(null);
    setAdded(null);
    if (!part.renderable) {
      setError("This stock is used on connections. It cannot be placed as a member.");
      return;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Give the member a label.");
      return;
    }
    let cuts: MemberCutInput[] | undefined;
    if (family.allowsCut && cutText.trim()) {
      let cutAt: number;
      try {
        cutAt = parseDimension(cutText.trim());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Cut length is not a dimension");
        return;
      }
      const length = stockLength(part, axes);
      if (!(cutAt > 0) || cutAt >= length - 1e-6) {
        setError(`Cut length must be greater than 0 and shorter than ${formatInches(length)}.`);
        return;
      }
      cuts = [{ axis: 0, angle: 90, at: cutAt }];
    }
    try {
      onCommit(
        addMember(text, {
          label: trimmed,
          stock: part.id,
          size: sizeOverride(part, axes),
          cuts,
        }),
      );
      setAdded(`Added ${trimmed}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the member");
    }
  }

  if (!part) return null;
  const axesSpec = freeAxes(part);

  return (
    <div className="flex min-h-0 basis-0 flex-1 flex-col overflow-auto border-t border-[#3d2a18]">
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div
          className={`flex min-w-0 items-center gap-3 ${part.renderable ? "cursor-grab active:cursor-grabbing" : ""}`}
          draggable={part.renderable}
          onDragStart={(event) => {
            if (!part.renderable) {
              event.preventDefault();
              return;
            }
            beginCatalogDrag(event, {
              label: label.trim() || family.defaultLabel,
              stock: part.id,
              size: previewSize,
              cuts: cutAt === undefined ? undefined : [{ axis: 0, angle: 90, at: cutAt }],
            });
          }}
        >
          <CatalogSwatch part={part} size={previewSize} cutAt={cutAt} />
          <h2 className="font-[family-name:var(--font-display)] text-base text-[#f59e0b]">{family.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="cursor-pointer text-xs text-[#a89070] hover:text-[#f59e0b]">
          Close
        </button>
      </div>
      <p className="px-3 pt-1 text-[11px] text-[#8a7355]">{part.notes ?? family.summary}</p>
      {parts.length > 1 ? (
        <div className="flex flex-wrap gap-1 px-3 pt-3">
          {parts.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === part.id}
              onClick={() => chooseVariant(item)}
              className={`cursor-pointer rounded border px-2 py-1 text-[11px] ${
                item.id === part.id
                  ? "border-[#f59e0b] text-[#f59e0b]"
                  : "border-[#3d2a18] text-[#a89070] hover:border-[#6b4a2b]"
              }`}
            >
              {variantLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
      {axesSpec.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 px-3 pt-3">
          {axesSpec.map((axis) => (
            <label key={axis.axis} className="text-[11px] text-[#a89070]">
              {axis.axis} ({formatInches(axis.min)}–{formatInches(axis.max)})
              <input
                type="number"
                min={axis.min}
                max={axis.max}
                step={0.125}
                value={axes[axis.axis] ?? axis.default}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setAxes((current) => ({ ...current, [axis.axis]: value }));
                  setAdded(null);
                }}
                className="mt-1 w-full rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm text-[#d6c3a3]"
              />
            </label>
          ))}
        </div>
      ) : null}
      {part.renderable ? (
        <>
          <label className="px-3 pt-3 text-[11px] text-[#a89070]">
            Label
            <input
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setAdded(null);
              }}
              className="mt-1 w-full rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm text-[#d6c3a3]"
            />
          </label>
          {family.allowsCut ? (
            <label className="px-3 pt-3 text-[11px] text-[#a89070]">
              Crosscut length
              <input
                value={cutText}
                placeholder={`Full ${formatInches(stockLength(part, axes))}`}
                onChange={(event) => {
                  setCutText(event.target.value);
                  setAdded(null);
                }}
                className="mt-1 w-full rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm text-[#d6c3a3] placeholder:text-[#8a7355]"
              />
            </label>
          ) : null}
          <div className="px-3 py-3">
            <button
              type="button"
              onClick={add}
              className="w-full cursor-pointer rounded border border-[#6b4a2b] bg-[#1a120b] px-3 py-2 text-sm text-[#f59e0b] hover:border-[#f59e0b]"
            >
              Add to build
            </button>
          </div>
        </>
      ) : (
        <p className="px-3 py-3 text-xs text-[#a89070]">
          Screws, bolts, and glue join members through a connection. Pick a member in the list and attach them there.
        </p>
      )}
      {error ? <p className="px-3 pb-3 text-xs text-rose-400">{error}</p> : null}
      {added ? <p className="px-3 pb-3 text-xs text-[#d6c3a3]">{added}</p> : null}
    </div>
  );
}

function axisDefaults(part: CatalogPart | undefined): Partial<Record<AxisName, number>> {
  const values: Partial<Record<AxisName, number>> = {};
  if (!part) return values;
  for (const axis of freeAxes(part)) values[axis.axis] = axis.default;
  return values;
}
