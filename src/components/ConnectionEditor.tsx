"use client";

import { useState, type ReactNode } from "react";
import { getFastenerSubtype, listCatalog } from "@/lib/catalog";
import { pickNailStock, type SceneConnection } from "@/lib/connections";
import { parseInstanceKey } from "@/lib/fasteners";
import type {
  ResolvedBoltVariant,
  ResolvedConnectionFastener,
  ResolvedNailVariant,
  ResolvedScrewVariant,
  ScrewJustify,
} from "@/lib/schema";

type ConnectionEditorProps = {
  connection: SceneConnection;
  allowConnector?: boolean;
  /** Inches the nail must span. Omitted when the joint has no measured contact. */
  nailReach?: number;
  onChange: (index: number, fastener: ResolvedConnectionFastener) => void;
  onClose: () => void;
};

const SCREW_VARIANTS = ["four-corners", "angle-bracket", "perimeter", "centered"] as const;
type ScrewVariantKind = (typeof SCREW_VARIANTS)[number];
const NAIL_VARIANTS = ["four-corners", "perimeter", "centered"] as const;
type NailVariantKind = (typeof NAIL_VARIANTS)[number];
const BOLT_VARIANTS = ["through", "angle-bracket"] as const;
type BoltVariantKind = (typeof BOLT_VARIANTS)[number];
const KINDS = ["screw", "nail", "glue", "bolt", "connector", "none"] as const;
type FastenerKind = (typeof KINDS)[number];

const KIND_LABEL: Record<FastenerKind, string> = {
  screw: "Screw",
  nail: "Nail",
  glue: "Glue",
  bolt: "Bolt",
  connector: "T-connector",
  none: "None",
};

const VARIANT_LABEL: Record<ScrewVariantKind | BoltVariantKind | "patch" | "edge", string> = {
  "four-corners": "Four corners",
  "angle-bracket": "Angle bracket",
  perimeter: "Perimeter",
  centered: "Centered",
  through: "Through",
  patch: "Patch",
  edge: "Edge",
};

function withEdge(fastener: ResolvedConnectionFastener, edge: number): ResolvedConnectionFastener {
  if (fastener.kind === "glue" && fastener.variant.kind === "edge") {
    return { ...fastener, variant: { kind: "edge", edge } };
  }
  if (fastener.kind === "bolt" && fastener.variant.kind === "angle-bracket") {
    return { ...fastener, variant: { ...fastener.variant, edge } };
  }
  if (fastener.kind === "nail") {
    const variant = fastener.variant;
    if (variant.kind === "four-corners" || variant.kind === "perimeter") {
      return { ...fastener, variant: { ...variant, edge } };
    }
    return fastener;
  }
  if (fastener.kind !== "screw") return fastener;
  const variant = fastener.variant;
  if (variant.kind === "four-corners" || variant.kind === "angle-bracket") {
    return { ...fastener, variant: { ...variant, edge } };
  }
  if (variant.kind === "perimeter") return { ...fastener, variant: { ...variant, edge } };
  return fastener;
}

function memberIdsOf(connection: SceneConnection): string[] {
  const ids: string[] = [];
  for (const key of connection.memberKeys) {
    const id = parseInstanceKey(key).memberId;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function withKind(kind: FastenerKind, nailReach?: number): ResolvedConnectionFastener {
  if (kind === "none") return { kind: "none" };
  if (kind === "glue") return { kind: "glue", stock: "wood-glue", variant: { kind: "patch" } };
  if (kind === "bolt") return { kind: "bolt", stock: "bolt-hex-3/8x4", variant: { kind: "through" } };
  if (kind === "nail") {
    return {
      kind: "nail",
      stock: pickNailStock(nailReach ?? 0),
      variant: { kind: "centered", separation: 4, justify: "space-around" },
    };
  }
  if (kind === "connector") return { kind: "connector", stock: "connector-t" };
  return {
    kind: "screw",
    stock: "screw-wood-8x2",
    variant: { kind: "centered", separation: 4, justify: "space-around" },
  };
}

function withScrewVariant(
  current: ResolvedScrewVariant,
  kind: ScrewVariantKind,
  memberIds: string[],
): ResolvedScrewVariant {
  const edge = "edge" in current ? current.edge : 0.75;
  const separation = "separation" in current ? current.separation : 4;
  const justify: ScrewJustify = "justify" in current ? current.justify : "space-around";
  const bracket = current.kind === "angle-bracket" && current.bracket ? current.bracket : (memberIds[0] ?? "");
  if (kind === "four-corners") return { kind, edge };
  if (kind === "angle-bracket") return { kind, bracket, edge };
  if (kind === "perimeter") return { kind, edge, separation, justify };
  return { kind: "centered", separation, justify };
}

function withNailVariant(current: ResolvedNailVariant, kind: NailVariantKind): ResolvedNailVariant {
  const edge = "edge" in current ? current.edge : 0.75;
  const separation = "separation" in current ? current.separation : 4;
  const justify: ScrewJustify = "justify" in current ? current.justify : "space-around";
  if (kind === "four-corners") return { kind, edge };
  if (kind === "perimeter") return { kind, edge, separation, justify };
  return { kind: "centered", separation, justify };
}

function withBoltVariant(current: ResolvedBoltVariant, kind: BoltVariantKind, memberIds: string[]): ResolvedBoltVariant {
  if (kind === "through") return { kind: "through" };
  const edge = current.kind === "angle-bracket" ? current.edge : 0.25;
  const bracket = current.kind === "angle-bracket" && current.bracket ? current.bracket : (memberIds[0] ?? "");
  return { kind: "angle-bracket", bracket, edge };
}

export function ConnectionEditor({
  connection,
  allowConnector = false,
  nailReach,
  onChange,
  onClose,
}: ConnectionEditorProps) {
  const memberIds = memberIdsOf(connection);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[#3d2a18] px-3 py-2">
        <h3 className="font-[family-name:var(--font-display)] text-sm text-[#f59e0b]">Connection</h3>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-xs text-[#a89070] hover:text-[#f59e0b]"
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {connection.fasteners.map((fastener, index) => (
          <FastenerFields
            key={`${connection.key}-${index}`}
            fastener={fastener}
            memberIds={memberIds}
            allowConnector={allowConnector || fastener.kind === "connector"}
            nailReach={nailReach}
            onChange={(next) => onChange(index, next)}
          />
        ))}
      </div>
    </div>
  );
}

function FastenerFields({
  fastener,
  memberIds,
  allowConnector,
  nailReach,
  onChange,
}: {
  fastener: ResolvedConnectionFastener;
  memberIds: string[];
  allowConnector: boolean;
  nailReach?: number;
  onChange: (fastener: ResolvedConnectionFastener) => void;
}) {
  const stocks =
    fastener.kind === "none" || fastener.kind === "connector"
      ? []
      : listCatalog("fastener").filter((item) => getFastenerSubtype(item.id) === fastener.kind);
  const kinds = KINDS.filter((kind) => kind !== "connector" || allowConnector);
  return (
    <section className="mb-4 border-b border-[#3d2a18]/70 pb-4 last:border-b-0">
      <div className="text-[10px] uppercase tracking-widest text-[#8a7355]">Kind</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {kinds.map((kind) => (
          <Choice
            key={kind}
            selected={fastener.kind === kind}
            onClick={() => {
              if (fastener.kind !== kind) onChange(withKind(kind, nailReach));
            }}
          >
            {KIND_LABEL[kind]}
          </Choice>
        ))}
      </div>

      {fastener.kind === "none" ? null : fastener.kind === "screw" ? (
        <>
          <div className="mt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">Variant</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {SCREW_VARIANTS.map((kind) => (
              <Choice
                key={kind}
                selected={fastener.variant.kind === kind}
                onClick={() => {
                  if (fastener.variant.kind === kind) return;
                  onChange({ ...fastener, variant: withScrewVariant(fastener.variant, kind, memberIds) });
                }}
              >
                {VARIANT_LABEL[kind]}
              </Choice>
            ))}
          </div>
        </>
      ) : fastener.kind === "nail" ? (
        <>
          <div className="mt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">Variant</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {NAIL_VARIANTS.map((kind) => (
              <Choice
                key={kind}
                selected={fastener.variant.kind === kind}
                onClick={() => {
                  if (fastener.kind !== "nail" || fastener.variant.kind === kind) return;
                  onChange({ ...fastener, variant: withNailVariant(fastener.variant, kind) });
                }}
              >
                {VARIANT_LABEL[kind]}
              </Choice>
            ))}
          </div>
        </>
      ) : fastener.kind === "glue" ? (
        <>
          <div className="mt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">Variant</div>
          <div className="mt-1 flex gap-1">
            {(["patch", "edge"] as const).map((kind) => (
              <Choice
                key={kind}
                selected={fastener.variant.kind === kind}
                onClick={() => {
                  if (fastener.kind !== "glue" || fastener.variant.kind === kind) return;
                  onChange(
                    kind === "patch"
                      ? { kind: "glue", stock: fastener.stock, variant: { kind: "patch" } }
                      : { kind: "glue", stock: fastener.stock, variant: { kind: "edge", edge: 0.5 } },
                  );
                }}
              >
                {VARIANT_LABEL[kind]}
              </Choice>
            ))}
          </div>
        </>
      ) : fastener.kind === "bolt" ? (
        <>
          <div className="mt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">Variant</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {BOLT_VARIANTS.map((kind) => (
              <Choice
                key={kind}
                selected={fastener.variant.kind === kind}
                onClick={() => {
                  if (fastener.kind !== "bolt" || fastener.variant.kind === kind) return;
                  onChange({ ...fastener, variant: withBoltVariant(fastener.variant, kind, memberIds) });
                }}
              >
                {VARIANT_LABEL[kind]}
              </Choice>
            ))}
          </div>
        </>
      ) : null}

      {fastener.kind === "none" || fastener.kind === "connector" ? null : (
        <>
          <div className="mt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">Stock</div>
          <ul className="mt-1 space-y-1">
            {stocks.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (fastener.stock !== item.id) onChange({ ...fastener, stock: item.id });
                  }}
                  className={`w-full cursor-pointer rounded border px-2 py-1.5 text-left text-sm ${
                    fastener.stock === item.id
                      ? "border-[#f59e0b] text-[#f59e0b]"
                      : "border-[#3d2a18] text-[#d6c3a3] hover:border-[#6b4a2b]"
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          <VariantOptions fastener={fastener} memberIds={memberIds} onChange={onChange} />
        </>
      )}
    </section>
  );
}

function VariantOptions({
  fastener,
  memberIds,
  onChange,
}: {
  fastener: ResolvedConnectionFastener;
  memberIds: string[];
  onChange: (fastener: ResolvedConnectionFastener) => void;
}) {
  if (fastener.kind === "none" || fastener.kind === "connector") return null;
  const variant = fastener.variant;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {variant.kind === "angle-bracket" ? (
        <label className="col-span-2 text-[10px] uppercase tracking-widest text-[#8a7355]">
          Bracket
          <select
            className="mt-1 w-full cursor-pointer rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm normal-case tracking-normal text-[#d6c3a3]"
            value={variant.bracket}
            onChange={(event) => {
              if (fastener.variant.kind !== "angle-bracket") return;
              if (fastener.kind !== "screw" && fastener.kind !== "bolt") return;
              onChange({ ...fastener, variant: { ...fastener.variant, bracket: event.target.value } });
            }}
          >
            {memberIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {"edge" in variant ? (
        <MeasureField
          key={`edge-${variant.edge}`}
          label="Edge"
          unit="in"
          value={variant.edge}
          min={0}
          onCommit={(edge) => onChange(withEdge(fastener, edge))}
        />
      ) : null}
      {"separation" in variant ? (
        <MeasureField
          key={`separation-${variant.separation}`}
          label="Separation"
          unit="in"
          value={variant.separation}
          min={0}
          exclusive
          onCommit={(separation) => {
            if ((fastener.kind !== "screw" && fastener.kind !== "nail") || !("separation" in fastener.variant)) return;
            onChange({ ...fastener, variant: { ...fastener.variant, separation } });
          }}
        />
      ) : null}
      {"justify" in variant ? (
        <div className="col-span-2">
          <div className="text-[10px] uppercase tracking-widest text-[#8a7355]">Justify</div>
          <div className="mt-1 flex gap-1">
            {(["space-between", "space-around"] as const).map((justify) => (
              <Choice
                key={justify}
                selected={variant.justify === justify}
                onClick={() => {
                  if (
                    (fastener.kind !== "screw" && fastener.kind !== "nail") ||
                    !("justify" in fastener.variant) ||
                    fastener.variant.justify === justify
                  ) {
                    return;
                  }
                  onChange({ ...fastener, variant: { ...fastener.variant, justify } });
                }}
              >
                {justify === "space-between" ? "Space between" : "Space around"}
              </Choice>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MeasureField({
  label,
  unit,
  value,
  min,
  exclusive = false,
  onCommit,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  exclusive?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const next = Number(draft);
    const valid = Number.isFinite(next) && (exclusive ? next > min : next >= min);
    if (!valid) {
      setDraft(String(value));
      return;
    }
    if (next !== value) onCommit(next);
  }

  return (
    <label className="text-[10px] uppercase tracking-widest text-[#8a7355]">
      {label}
      <span className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          step="0.0625"
          min={exclusive ? undefined : min}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="min-w-0 flex-1 rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm normal-case tracking-normal text-[#d6c3a3]"
        />
        {unit ? <span className="normal-case tracking-normal text-xs text-[#a89070]">{unit}</span> : null}
      </span>
    </label>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`cursor-pointer rounded border px-2 py-1 text-xs ${
        selected
          ? "border-[#f59e0b] text-[#f59e0b]"
          : "border-[#3d2a18] text-[#d6c3a3] hover:border-[#6b4a2b]"
      }`}
    >
      {children}
    </button>
  );
}
