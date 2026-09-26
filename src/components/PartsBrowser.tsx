"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fitsTConnector, getCatalogPart } from "@/lib/catalog";
import { connectionKey, connectionNailReach, detailNeighborKeys, type SceneConnection } from "@/lib/connections";
import { addConnection, promoteExplicitFasteners, setConnectionFastener } from "@/lib/edit";
import { parseInstanceKey } from "@/lib/fasteners";
import type { ResolvedBore, ResolvedConnectionFastener, ResolvedCut, ResolvedDocument, ResolvedMember } from "@/lib/schema";
import type { SceneContacts } from "@/lib/geometry";
import type { SceneFastener, SceneModel, SceneMemberInstance } from "@/lib/scene";
import { formatInches } from "@/lib/units";
import { ConnectionEditor } from "./ConnectionEditor";
import { FastenerIcon } from "./FastenerIcon";
import { MemberThumbnail } from "./MemberThumbnail";

type PartsBrowserProps = {
  scene?: SceneModel;
  document?: ResolvedDocument;
  text: string;
  onCommit: (text: string) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onHover: (key: string | null) => void;
  onActiveConnection: (key: string | null) => void;
};

const AXIS_NAME = ["length (L)", "width (W)", "thickness (T)"] as const;

function formatFinished(finished: SceneMemberInstance["finished"]): string {
  return `${formatInches(finished.length)} × ${formatInches(finished.width)} × ${formatInches(finished.thickness)}`;
}

function formatCutAt(at: number | [number, number]): string {
  if (Array.isArray(at)) return `${formatInches(at[0])}–${formatInches(at[1])}`;
  return formatInches(at);
}

function formatBore(bore: ResolvedBore): string {
  const depth = bore.through ? "through" : `${formatInches(bore.depth)} deep`;
  return `${bore.face} at ${formatInches(bore.at[0])}, ${formatInches(bore.at[1])} · dia ${formatInches(bore.diameter)} · ${depth}`;
}

function formatCut(cut: ResolvedCut): string {
  const kind = Math.abs(cut.angle - 90) < 1e-6 ? "Square" : `${cut.angle}°`;
  const bits = [`${kind} on ${AXIS_NAME[cut.axis]}`, `at ${formatCutAt(cut.at)}`, `from ${cut.side}`];
  if (cut.around !== undefined) bits.push(`around ${AXIS_NAME[cut.around]}`);
  return bits.join(" · ");
}

function instanceMap(scene: SceneModel): Map<string, SceneMemberInstance> {
  return new Map(scene.components.flatMap((component) => component.members).map((member) => [member.key, member]));
}

function memberLabel(instanceKey: string, byKey: Map<string, SceneMemberInstance>): string {
  return byKey.get(instanceKey)?.label ?? parseInstanceKey(instanceKey).memberId;
}

function fastenerJoins(fastener: SceneFastener, byKey: Map<string, SceneMemberInstance>, excludeKey?: string): string {
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

function unusedMembers(document: ResolvedDocument, scene: SceneModel): ResolvedMember[] {
  const used = new Set(scene.components.flatMap((component) => component.members.map((member) => member.memberId)));
  return document.members.filter((member) => !used.has(member.id));
}

type AttachedPart = {
  instance: SceneMemberInstance;
  fasteners: SceneFastener[];
};

function attachedPartsFor(
  selectedKey: string,
  fasteners: SceneFastener[],
  connections: Array<Pick<SceneConnection, "memberKeys">>,
  contacts: SceneContacts,
  byKey: Map<string, SceneMemberInstance>,
): AttachedPart[] {
  const byNeighbor = new Map<string, SceneFastener[]>();
  for (const key of detailNeighborKeys(selectedKey, connections, fasteners, contacts)) {
    byNeighbor.set(key, []);
  }
  for (const fastener of fasteners) {
    for (const member of fastener.members) {
      if (member.instanceKey === selectedKey) continue;
      byNeighbor.get(member.instanceKey)?.push(fastener);
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
  if (fastener.subtype === "glue") return "bead";
  return `${formatInches(fastener.length)} × ${formatInches(fastener.diameter)}`;
}

function parseExplicitKey(key: string): { componentId: string | null; index: number } {
  if (key.startsWith("fastener#")) {
    return { componentId: null, index: Number(key.slice("fastener#".length)) };
  }
  const marker = "/fastener#";
  const split = key.lastIndexOf(marker);
  return { componentId: key.slice(0, split), index: Number(key.slice(split + marker.length)) };
}

function titleKind(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function bracketMemberIds(connections: SceneConnection[], selectedKey: string): Set<string> {
  const ids = new Set<string>();
  for (const connection of connections) {
    if (!connection.memberKeys.includes(selectedKey)) continue;
    for (const fastener of connection.fasteners) {
      if ((fastener.kind === "screw" || fastener.kind === "bolt") && fastener.variant.kind === "angle-bracket") {
        ids.add(fastener.variant.bracket);
      }
    }
  }
  return ids;
}

function connectionSummary(connection: SceneConnection): {
  kind: "screw" | "nail" | "glue" | "bolt" | "bracket" | "connector" | "none";
  label: string;
  detail: string;
} {
  const recipes = connection.fasteners.filter((recipe) => recipe.kind !== "none");
  if (recipes.length === 0) return { kind: "none", label: "None", detail: "" };
  if (recipes.some((recipe) => recipe.kind === "connector")) {
    return { kind: "connector", label: "T-connector", detail: "" };
  }
  const bracket = recipes.find(
    (recipe) => (recipe.kind === "screw" || recipe.kind === "bolt") && recipe.variant.kind === "angle-bracket",
  );
  if (bracket && (bracket.kind === "screw" || bracket.kind === "bolt")) {
    const catalog = getCatalogPart(bracket.stock);
    const detail = catalog ? `${formatInches(catalog.size[0])} × ${formatInches(catalog.size[1])}` : bracket.stock;
    return { kind: "bracket", label: "Bracket", detail };
  }
  const primary =
    recipes.find((recipe) => recipe.kind === "screw") ??
    recipes.find((recipe) => recipe.kind === "nail") ??
    recipes[0];
  const kinds = (["screw", "nail", "bolt", "glue"] as const).filter((kind) =>
    recipes.some((recipe) => recipe.kind === kind),
  );
  const label = kinds.map(titleKind).join(" + ");
  if (!primary || primary.kind === "glue") return { kind: "glue", label: label || "Glue", detail: "bead" };
  const catalog = getCatalogPart(primary.stock);
  const detail = catalog ? `${formatInches(catalog.size[0])} × ${formatInches(catalog.size[1])}` : primary.stock;
  return { kind: primary.kind, label, detail };
}

function iconKind(subtype: string): "screw" | "nail" | "glue" | "bolt" | "connector" {
  if (subtype === "glue" || subtype === "bolt" || subtype === "nail" || subtype === "connector") return subtype;
  return "screw";
}

function occurrenceOf(scene: SceneModel, key: string): number {
  const { componentId, memberId } = parseInstanceKey(key);
  const component = scene.components.find((item) => item.id === componentId);
  if (!component) return 0;
  let seen = 0;
  for (const member of component.members) {
    if (member.memberId !== memberId) continue;
    if (member.key === key) return seen;
    seen += 1;
  }
  return 0;
}

function allowsTConnector(connection: SceneConnection, byKey: Map<string, SceneMemberInstance>): boolean {
  return connection.memberKeys.some((key) => {
    const part = getCatalogPart(byKey.get(key)?.stockId ?? "");
    return part ? fitsTConnector(part) : false;
  });
}

function nailReachFor(connection: SceneConnection, scene: SceneModel): number | undefined {
  const posed = [];
  for (const key of connection.memberKeys) {
    const component = scene.components.find((item) => item.members.some((member) => member.key === key));
    const part = component?.members.find((member) => member.key === key);
    if (!component || !part) continue;
    posed.push({
      key,
      faces: part.faces,
      position: part.position,
      rotation: part.rotation,
      componentPosition: component.position,
      componentRotation: component.rotation,
    });
  }
  return connectionNailReach(scene.contacts, posed);
}

export function PartsBrowser({
  scene,
  document,
  text,
  onCommit,
  selectedKey,
  onSelect,
  onHover,
  onActiveConnection,
}: PartsBrowserProps) {
  useEffect(() => () => onHover(null), [onHover]);

  if (!scene || !document) {
    return (
      <div className="flex min-h-0 flex-1 items-start px-4 py-6 text-sm text-[#a89070]">
        Fix YAML to browse members.
      </div>
    );
  }

  const byKey = instanceMap(scene);
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;
  if (selected) {
    return (
      <PartDetail
        key={selected.key}
        instance={selected}
        definition={document.members.find((member) => member.id === selected.memberId)}
        fasteners={scene.fasteners.filter((fastener) =>
          fastener.members.some((member) => member.instanceKey === selected.key),
        )}
        scene={scene}
        document={document}
        text={text}
        onCommit={onCommit}
        onActiveConnection={onActiveConnection}
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
  const unused = unusedMembers(document, scene);

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      {scene.components.map((component) => {
        const fasteners = local.get(component.id) ?? [];
        return (
          <section key={component.id} className="border-b border-[#3d2a18]/80">
            <h2 className="px-3 pb-1 pt-4 font-[family-name:var(--font-display)] text-sm text-[#f59e0b]">
              {component.label}
            </h2>
            <SectionLabel>Members</SectionLabel>
            {component.members.length === 0 ? (
              <EmptyRow>No members</EmptyRow>
            ) : (
              <ul>
                {component.members.map((part) => (
                  <li key={part.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(part.key)}
                      className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[#2a1d12]"
                    >
                      <span className="text-sm text-[#d6c3a3]">{part.label}</span>
                      <span className="text-[11px] text-[#8a7355]">
                        {part.memberId} · {part.stockLabel} · {formatFinished(part.finished)}
                      </span>
                      {part.bores.length > 0 ? (
                        <span className="text-[11px] text-[#a89070]">{part.bores.map(formatBore).join("; ")}</span>
                      ) : null}
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
            Unused members
          </h2>
          <ul>
            {unused.map((part) => (
              <li key={part.id} className="px-3 py-1.5">
                <div className="text-sm text-[#d6c3a3]">{part.label}</div>
                <div className="text-[11px] text-[#8a7355]">
                  {part.id} · {part.stock}
                  {part.cuts.length > 0 ? ` · ${part.cuts.length} cut${part.cuts.length === 1 ? "" : "s"}` : ""}
                  {part.bores.length > 0 ? ` · ${part.bores.length} bore${part.bores.length === 1 ? "" : "s"}` : ""}
                </div>
                {part.bores.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-[#a89070]">
                    {part.bores.map((bore, index) => (
                      <li key={`${part.id}-bore-${index}`}>{formatBore(bore)}</li>
                    ))}
                  </ul>
                ) : null}
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
  scene,
  document,
  text,
  onCommit,
  onActiveConnection,
  byKey,
  onBack,
  onSelect,
  onHover,
}: {
  instance: SceneMemberInstance;
  definition?: ResolvedMember;
  fasteners: SceneFastener[];
  scene: SceneModel;
  document: ResolvedDocument;
  text: string;
  onCommit: (text: string) => void;
  onActiveConnection: (key: string | null) => void;
  byKey: Map<string, SceneMemberInstance>;
  onBack: () => void;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => () => onActiveConnection(null), [onActiveConnection]);
  const cuts = definition?.cuts ?? [];
  const attached = attachedPartsFor(instance.key, fasteners, scene.connections, scene.contacts, byKey).filter(
    (neighbor) => !bracketMemberIds(scene.connections, instance.key).has(neighbor.instance.memberId),
  );
  const active = scene.connections.find((connection) => connection.key === activeKey) ?? null;

  function chooseConnection(key: string | null) {
    setActiveKey(key);
    onActiveConnection(key);
  }

  function commitNext(next: string) {
    textRef.current = next;
    onCommit(next);
  }

  function writeFastener(index: number, fastener: ResolvedConnectionFastener) {
    if (!active) return;
    const componentId = active.componentId;
    try {
      commitNext(setConnectionFastener(textRef.current, componentId, active.index, index, fastener));
    } catch {
      // Leave the YAML alone if the AST cannot be updated.
    }
  }

  function attachNone(neighborKey: string) {
    const selectedRef = parseInstanceKey(instance.key);
    const neighborRef = parseInstanceKey(neighborKey);
    const shared = selectedRef.componentId === neighborRef.componentId ? selectedRef.componentId : null;
    const nextIndex = shared
      ? (document.components.find((component) => component.id === shared)?.connections.length ?? 0)
      : document.connections.length;
    try {
      commitNext(
        addConnection(textRef.current, [
          { componentId: selectedRef.componentId, id: selectedRef.memberId, index: occurrenceOf(scene, instance.key) },
          {
            componentId: neighborRef.componentId,
            id: neighborRef.memberId,
            index: occurrenceOf(scene, neighborKey),
          },
        ]),
      );
      chooseConnection(connectionKey(shared, nextIndex));
    } catch {
      // Leave the YAML alone if the connection cannot be appended.
    }
  }

  function promote(explicit: SceneFastener[]) {
    const homes = explicit.map((fastener) => parseExplicitKey(fastener.key));
    const componentId = homes[0]?.componentId ?? null;
    if (homes.length === 0 || homes.some((home) => home.componentId !== componentId)) return;
    const nextIndex = componentId
      ? (document.components.find((component) => component.id === componentId)?.connections.length ?? 0)
      : document.connections.length;
    try {
      commitNext(promoteExplicitFasteners(textRef.current, componentId, homes.map((home) => home.index)));
      chooseConnection(connectionKey(componentId, nextIndex));
    } catch {
      // Leave the YAML alone if the explicit fasteners cannot be promoted.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`min-h-0 overflow-auto ${active ? "basis-0 flex-1" : "flex-1"}`}>
        <div className="sticky top-0 border-b border-[#3d2a18] bg-[#1a120b] px-3 py-2">
          <button
            type="button"
            onClick={onBack}
            className="cursor-pointer text-xs text-[#a89070] hover:text-[#f59e0b]"
          >
            ← All members
          </button>
        </div>
        <div className="py-3">
          <div className="px-3">
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[#f59e0b]">{instance.label}</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[#a89070]">
              <dt>id</dt>
              <dd className="text-[#d6c3a3]">{instance.memberId}</dd>
              <dt>stock</dt>
              <dd className="text-[#d6c3a3]">{instance.stockLabel}</dd>
            </dl>
          </div>

          <SectionLabel>Dimensions</SectionLabel>
          <p className="px-3 text-sm text-[#d6c3a3]">{formatFinished(instance.finished)}</p>
          <p className="px-3 text-[11px] text-[#8a7355]">L × W × T (length × width × thickness)</p>

          <SectionLabel>Bores</SectionLabel>
          {instance.bores.length === 0 ? (
            <p className="px-3 text-xs text-[#8a7355]">No bores</p>
          ) : (
            <ul className="space-y-1 px-3 text-xs text-[#d6c3a3]">
              {instance.bores.map((bore, index) => (
                <li key={`${instance.memberId}-bore-${index}`}>{formatBore(bore)}</li>
              ))}
            </ul>
          )}

          <SectionLabel>Cuts</SectionLabel>
          {cuts.length === 0 ? (
            <p className="px-3 text-xs text-[#8a7355]">No cuts</p>
          ) : (
            <ul className="space-y-1 px-3 text-xs text-[#d6c3a3]">
              {cuts.map((cut, index) => (
                <li key={`${instance.memberId}-cut-${index}`}>{formatCut(cut)}</li>
              ))}
            </ul>
          )}

          <SectionLabel>Attached</SectionLabel>
          {attached.length === 0 ? (
            <p className="px-3 text-xs text-[#8a7355]">None attached</p>
          ) : (
            <ul>
              {attached.map((neighbor) => {
                const pair = scene.connections.filter(
                  (connection) =>
                    connection.memberKeys.includes(instance.key) &&
                    connection.memberKeys.includes(neighbor.instance.key),
                );
                const explicit = neighbor.fasteners.filter((fastener) => !fastener.connectionKey);
                return (
                  <li key={neighbor.instance.key} className="flex items-stretch gap-2 border-b border-[#3d2a18]/60 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(neighbor.instance.key)}
                      onMouseEnter={() => onHover(neighbor.instance.key)}
                      onMouseLeave={() => onHover(null)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded px-1 text-left hover:bg-[#2a1d12]"
                    >
                      <MemberThumbnail instance={neighbor.instance} />
                      <span className="min-w-0">
                        <span className="block truncate text-base text-[#d6c3a3]">{neighbor.instance.label}</span>
                        <span className="block truncate text-xs text-[#8a7355]">{neighbor.instance.memberId}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {pair.map((connection) => (
                        <ConnectionTile
                          key={connection.key}
                          connection={connection}
                          active={connection.key === activeKey}
                          headCovered={scene.fasteners.some(
                            (fastener) => fastener.connectionKey === connection.key && fastener.headCovered,
                          )}
                          onOpen={() => chooseConnection(activeKey === connection.key ? null : connection.key)}
                        />
                      ))}
                      {pair.length === 0 && explicit.length === 0 ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            attachNone(neighbor.instance.key);
                          }}
                          className="flex w-[4.75rem] cursor-pointer flex-col items-center gap-0.5 rounded border border-dashed border-[#8a7355] px-1 py-1.5 text-[#a89070] hover:border-[#d6c3a3]"
                        >
                          <span className="grid h-10 w-10 place-items-center rounded bg-[#140e09]">
                            <FastenerIcon kind="none" />
                          </span>
                          <span className="text-center text-xs leading-tight">None</span>
                          <span className="text-[10px] text-[#8a7355]"> </span>
                        </button>
                      ) : null}
                      {pair.length === 0 && explicit.length > 0 ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            promote(explicit);
                          }}
                          className="flex w-[4.75rem] cursor-pointer flex-col items-center gap-0.5 rounded border border-[#3d2a18] px-1 py-1.5 text-[#d6c3a3] hover:border-[#6b4a2b]"
                        >
                          <span className="grid h-10 w-10 place-items-center rounded bg-[#140e09] text-[#f59e0b]">
                            <FastenerIcon kind={iconKind(explicit[0].subtype)} />
                          </span>
                          <span className="text-xs">{titleKind(explicit[0].subtype)}</span>
                          <span className="text-[10px] text-[#8a7355]">{formatFastenerLine(explicit[0])}</span>
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {active ? (
        <div className="flex min-h-0 basis-0 flex-1 flex-col border-t border-[#3d2a18]">
          <ConnectionEditor
            connection={active}
            allowConnector={allowsTConnector(active, byKey)}
            nailReach={nailReachFor(active, scene)}
            onChange={writeFastener}
            onClose={() => chooseConnection(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ConnectionTile({
  connection,
  active,
  headCovered,
  onOpen,
}: {
  connection: SceneConnection;
  active: boolean;
  headCovered: boolean;
  onOpen: () => void;
}) {
  const summary = connectionSummary(connection);
  const empty = summary.kind === "none";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      className={`relative flex w-[4.75rem] cursor-pointer flex-col items-center gap-0.5 rounded border px-1 py-1.5 ${
        empty
          ? active
            ? "border-dashed border-[#d6c3a3] text-[#d6c3a3]"
            : "border-dashed border-[#8a7355] text-[#a89070] hover:border-[#d6c3a3]"
          : headCovered
            ? active
              ? "border-rose-400 text-rose-400"
              : "border-rose-400/70 text-rose-400 hover:border-rose-400"
            : active
              ? "border-[#f59e0b] text-[#f59e0b]"
              : "border-[#3d2a18] text-[#d6c3a3] hover:border-[#6b4a2b]"
      }`}
    >
      <span className="relative grid h-10 w-10 place-items-center rounded bg-[#140e09]">
        <FastenerIcon kind={summary.kind} />
        {headCovered ? (
          <span className="absolute -right-1 -top-1 text-rose-400">
            <AlertIcon />
          </span>
        ) : null}
      </span>
      <span className="text-center text-xs leading-tight">{summary.label}</span>
      <span className={`text-center text-[10px] leading-tight ${headCovered ? "text-rose-400" : "text-[#8a7355]"}`}>
        {headCovered ? "head covered" : summary.detail}
      </span>
    </button>
  );
}

function FastenerRow({
  fastener,
  byKey,
}: {
  fastener: SceneFastener;
  byKey: Map<string, SceneMemberInstance>;
}) {
  const joins = fastenerJoins(fastener, byKey);
  const covered = fastener.headCovered === true;
  return (
    <li className="px-3 py-1.5">
      <div className={`text-sm ${covered ? "text-rose-400" : "text-[#d6c3a3]"}`}>{fastener.stockLabel}</div>
      <div className={`text-[11px] ${covered ? "text-rose-400" : "text-[#8a7355]"}`}>
        {covered ? (
          <span className="mr-1 inline-block align-[-1px]" aria-hidden="true">
            <AlertIcon />
          </span>
        ) : null}
        {fastener.subtype}
        {joins ? ` · ${joins}` : ""}
        {covered ? " · head covered" : ""}
      </div>
    </li>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" className="inline h-3 w-3" aria-hidden="true">
      <path fill="currentColor" d="M8 1.2 15 14H1L8 1.2zm0 4.2-.7 4.2h1.4L8 5.4zM8 12.6a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6z" />
    </svg>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">{children}</div>;
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-2 text-xs text-[#8a7355]">{children}</p>;
}
