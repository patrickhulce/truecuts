"use client";

import { useEffect, type ReactNode } from "react";
import { parseInstanceKey } from "@/lib/fasteners";
import type { ResolvedCut, ResolvedDocument, ResolvedPart } from "@/lib/schema";
import type { SceneFastener, SceneModel, ScenePartInstance } from "@/lib/scene";
import { formatInches } from "@/lib/units";

type PartsBrowserProps = {
  scene?: SceneModel;
  document?: ResolvedDocument;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onHover: (key: string | null) => void;
};

const AXIS_NAME = ["length (L)", "width (W)", "thickness (T)"] as const;

function formatFinished(finished: ScenePartInstance["finished"]): string {
  return `${formatInches(finished.length)} × ${formatInches(finished.width)} × ${formatInches(finished.thickness)}`;
}

function formatCutAt(at: number | [number, number]): string {
  if (Array.isArray(at)) return `${formatInches(at[0])}–${formatInches(at[1])}`;
  return formatInches(at);
}

function formatCut(cut: ResolvedCut): string {
  const kind = Math.abs(cut.angle - 90) < 1e-6 ? "Square" : `${cut.angle}°`;
  const bits = [`${kind} on ${AXIS_NAME[cut.axis]}`, `at ${formatCutAt(cut.at)}`, `from ${cut.side}`];
  if (cut.around !== undefined) bits.push(`around ${AXIS_NAME[cut.around]}`);
  return bits.join(" · ");
}

function instanceMap(scene: SceneModel): Map<string, ScenePartInstance> {
  return new Map(scene.components.flatMap((component) => component.parts).map((part) => [part.key, part]));
}

function memberLabel(instanceKey: string, byKey: Map<string, ScenePartInstance>): string {
  return byKey.get(instanceKey)?.label ?? parseInstanceKey(instanceKey).partId;
}

function fastenerJoins(fastener: SceneFastener, byKey: Map<string, ScenePartInstance>, excludeKey?: string): string {
  const labels = fastener.members
    .filter((member) => member.instanceKey !== excludeKey)
    .map((member) => memberLabel(member.instanceKey, byKey));
  return [...new Set(labels)].join(" · ");
}

function componentIdOf(instanceKey: string): string {
  return parseInstanceKey(instanceKey).componentId;
}

function groupFasteners(scene: SceneModel): {
  local: Map<string, SceneFastener[]>;
  assembly: SceneFastener[];
} {
  const local = new Map<string, SceneFastener[]>();
  const assembly: SceneFastener[] = [];
  for (const fastener of scene.fasteners) {
    const ids = new Set(fastener.members.map((member) => componentIdOf(member.instanceKey)));
    if (ids.size !== 1) {
      assembly.push(fastener);
      continue;
    }
    const id = ids.values().next().value;
    if (!id) continue;
    const list = local.get(id) ?? [];
    list.push(fastener);
    local.set(id, list);
  }
  return { local, assembly };
}

function unusedParts(document: ResolvedDocument, scene: SceneModel): ResolvedPart[] {
  const used = new Set(scene.components.flatMap((component) => component.parts.map((part) => part.partId)));
  return document.parts.filter((part) => !used.has(part.id));
}

type AttachedPart = {
  instance: ScenePartInstance;
  fasteners: SceneFastener[];
};

function attachedPartsFor(
  selectedKey: string,
  fasteners: SceneFastener[],
  byKey: Map<string, ScenePartInstance>,
): AttachedPart[] {
  const byNeighbor = new Map<string, SceneFastener[]>();
  for (const fastener of fasteners) {
    for (const member of fastener.members) {
      if (member.instanceKey === selectedKey) continue;
      const list = byNeighbor.get(member.instanceKey) ?? [];
      list.push(fastener);
      byNeighbor.set(member.instanceKey, list);
    }
  }
  const attached: AttachedPart[] = [];
  for (const [key, memberFasteners] of byNeighbor) {
    const instance = byKey.get(key);
    if (!instance) continue;
    attached.push({ instance, fasteners: memberFasteners });
  }
  return attached;
}

function formatFastenerLine(fastener: SceneFastener): string {
  if (fastener.subtype === "screw") {
    return `${fastener.subtype} · ${formatInches(fastener.length)} × ${formatInches(fastener.diameter)}`;
  }
  return fastener.subtype;
}

export function PartsBrowser({ scene, document, selectedKey, onSelect, onHover }: PartsBrowserProps) {
  useEffect(() => () => onHover(null), [onHover]);

  if (!scene || !document) {
    return (
      <div className="flex min-h-0 flex-1 items-start px-4 py-6 text-sm text-[#a89070]">
        Fix YAML to browse parts.
      </div>
    );
  }

  const byKey = instanceMap(scene);
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;
  if (selected) {
    return (
      <PartDetail
        instance={selected}
        definition={document.parts.find((part) => part.id === selected.partId)}
        fasteners={scene.fasteners.filter((fastener) =>
          fastener.members.some((member) => member.instanceKey === selected.key),
        )}
        byKey={byKey}
        onBack={() => {
          onHover(null);
          onSelect(null);
        }}
        onSelect={onSelect}
        onHover={onHover}
      />
    );
  }

  const { local, assembly } = groupFasteners(scene);
  const unused = unusedParts(document, scene);

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      {scene.components.map((component) => {
        const fasteners = local.get(component.id) ?? [];
        return (
          <section key={component.id} className="border-b border-[#3d2a18]/80">
            <h2 className="px-3 pb-1 pt-4 font-[family-name:var(--font-display)] text-sm text-[#f59e0b]">
              {component.label}
            </h2>
            <SectionLabel>Parts</SectionLabel>
            {component.parts.length === 0 ? (
              <EmptyRow>No parts</EmptyRow>
            ) : (
              <ul>
                {component.parts.map((part) => (
                  <li key={part.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(part.key)}
                      className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[#2a1d12]"
                    >
                      <span className="text-sm text-[#d6c3a3]">{part.label}</span>
                      <span className="text-[11px] text-[#8a7355]">
                        {part.partId} · {part.stockLabel} · {formatFinished(part.finished)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {fasteners.length > 0 ? (
              <>
                <SectionLabel>Fasteners</SectionLabel>
                <ul>
                  {fasteners.map((fastener) => (
                    <FastenerRow key={fastener.key} fastener={fastener} byKey={byKey} />
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        );
      })}
      {assembly.length > 0 ? (
        <section className="border-b border-[#3d2a18]/80">
          <h2 className="px-3 pb-1 pt-4 font-[family-name:var(--font-display)] text-sm text-[#f59e0b]">
            Assembly fasteners
          </h2>
          <ul>
            {assembly.map((fastener) => (
              <FastenerRow key={fastener.key} fastener={fastener} byKey={byKey} />
            ))}
          </ul>
        </section>
      ) : null}
      {unused.length > 0 ? (
        <section>
          <h2 className="px-3 pb-1 pt-4 font-[family-name:var(--font-display)] text-sm text-[#f59e0b]">
            Unused parts
          </h2>
          <ul>
            {unused.map((part) => (
              <li key={part.id} className="px-3 py-1.5">
                <div className="text-sm text-[#d6c3a3]">{part.label}</div>
                <div className="text-[11px] text-[#8a7355]">
                  {part.id} · {part.stock}
                  {part.cuts.length > 0 ? ` · ${part.cuts.length} cut${part.cuts.length === 1 ? "" : "s"}` : ""}
                </div>
                {part.cuts.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-[#a89070]">
                    {part.cuts.map((cut, index) => (
                      <li key={`${part.id}-cut-${index}`}>{formatCut(cut)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PartDetail({
  instance,
  definition,
  fasteners,
  byKey,
  onBack,
  onSelect,
  onHover,
}: {
  instance: ScenePartInstance;
  definition?: ResolvedPart;
  fasteners: SceneFastener[];
  byKey: Map<string, ScenePartInstance>;
  onBack: () => void;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}) {
  const cuts = definition?.cuts ?? [];
  const attached = attachedPartsFor(instance.key, fasteners, byKey);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="sticky top-0 border-b border-[#3d2a18] bg-[#1a120b] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-xs text-[#a89070] hover:text-[#f59e0b]"
        >
          ← All parts
        </button>
      </div>
      <div className="py-3">
        <div className="px-3">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[#f59e0b]">{instance.label}</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[#a89070]">
            <dt>id</dt>
            <dd className="text-[#d6c3a3]">{instance.partId}</dd>
            <dt>stock</dt>
            <dd className="text-[#d6c3a3]">{instance.stockLabel}</dd>
          </dl>
        </div>

        <SectionLabel>Dimensions</SectionLabel>
        <p className="px-3 text-sm text-[#d6c3a3]">{formatFinished(instance.finished)}</p>
        <p className="px-3 text-[11px] text-[#8a7355]">L × W × T (length × width × thickness)</p>

        <SectionLabel>Cuts</SectionLabel>
        {cuts.length === 0 ? (
          <p className="px-3 text-xs text-[#8a7355]">No cuts</p>
        ) : (
          <ul className="space-y-1 px-3 text-xs text-[#d6c3a3]">
            {cuts.map((cut, index) => (
              <li key={`${instance.partId}-cut-${index}`}>{formatCut(cut)}</li>
            ))}
          </ul>
        )}

        <SectionLabel>Attached parts</SectionLabel>
        {attached.length === 0 ? (
          <p className="px-3 text-xs text-[#8a7355]">None attached</p>
        ) : (
          <ul>
            {attached.map((neighbor) => (
              <li key={neighbor.instance.key}>
                <button
                  type="button"
                  onClick={() => onSelect(neighbor.instance.key)}
                  onMouseEnter={() => onHover(neighbor.instance.key)}
                  onMouseLeave={() => onHover(null)}
                  className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[#2a1d12]"
                >
                  <span className="text-sm text-[#d6c3a3]">{neighbor.instance.label}</span>
                  <span className="text-[11px] text-[#8a7355]">
                    {neighbor.instance.partId} · {neighbor.instance.stockLabel}
                  </span>
                  <span className="mt-1 flex flex-col gap-0.5 text-[11px] text-[#a89070]">
                    {neighbor.fasteners.map((fastener) => (
                      <span key={fastener.key}>
                        {fastener.stockLabel} · {formatFastenerLine(fastener)}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FastenerRow({
  fastener,
  byKey,
}: {
  fastener: SceneFastener;
  byKey: Map<string, ScenePartInstance>;
}) {
  const joins = fastenerJoins(fastener, byKey);
  return (
    <li className="px-3 py-1.5">
      <div className="text-sm text-[#d6c3a3]">{fastener.stockLabel}</div>
      <div className="text-[11px] text-[#8a7355]">
        {fastener.subtype}
        {joins ? ` · ${joins}` : ""}
      </div>
    </li>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">{children}</div>;
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-2 text-xs text-[#8a7355]">{children}</p>;
}
