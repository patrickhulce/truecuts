"use client";

import { useState, type ReactNode } from "react";
import type { CompileResult } from "@/lib/compile";
import { parseInstanceKey } from "@/lib/fasteners";
import type { SceneModel } from "@/lib/scene";
import { formatInches } from "@/lib/units";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { PartsBrowser } from "./PartsBrowser";
import { YamlEditor } from "./YamlEditor";

type Tab = "parts" | "yaml";

type EditorPanelProps = {
  text: string;
  onChangeText: (value: string) => void;
  onCommit: (value: string) => void;
  compiled: CompileResult;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onHover: (key: string | null) => void;
  activeConnectionKey: string | null;
  onActiveConnection: (key: string | null) => void;
};

function debugBoreLines(scene: SceneModel | undefined, connectionKey: string | null): string[] | null {
  if (!connectionKey || !scene) return null;
  const connection = scene.connections.find((item) => item.key === connectionKey);
  if (!connection) return null;
  const labels = new Map(
    scene.components.flatMap((component) => component.members).map((member) => [member.key, member.label]),
  );
  return connection.bores.map((derived) => {
    const label = labels.get(derived.instanceKey) ?? parseInstanceKey(derived.instanceKey).memberId;
    const depth = derived.bore.through ? "through" : `${formatInches(derived.bore.depth)} deep`;
    return `${label} · ${derived.role} · ${formatInches(derived.bore.diameter)} · ${depth}`;
  });
}

export function EditorPanel({
  text,
  onChangeText,
  onCommit,
  compiled,
  selectedKey,
  onSelect,
  onHover,
  activeConnectionKey,
  onActiveConnection,
}: EditorPanelProps) {
  const [tab, setTab] = useState<Tab>("parts");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Editor views" className="flex border-b border-[#3d2a18] bg-[#241a10] px-2">
        <TabButton id="parts" selected={tab === "parts"} onSelect={setTab}>
          Members
        </TabButton>
        <TabButton id="yaml" selected={tab === "yaml"} onSelect={setTab}>
          YAML
        </TabButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {tab === "parts" ? (
          <PartsBrowser
            scene={compiled.scene}
            document={compiled.document}
            text={text}
            onCommit={onCommit}
            selectedKey={selectedKey}
            onSelect={onSelect}
            onHover={onHover}
            onActiveConnection={onActiveConnection}
          />
        ) : (
          <div className="min-h-0 flex-1">
            <YamlEditor value={text} onChange={onChangeText} diagnostics={compiled.diagnostics} />
          </div>
        )}
      </div>
      <DiagnosticsPanel
        diagnostics={compiled.diagnostics}
        debugLines={debugBoreLines(compiled.scene, activeConnectionKey)}
      />
    </div>
  );
}

function TabButton({
  id,
  selected,
  onSelect,
  children,
}: {
  id: Tab;
  selected: boolean;
  onSelect: (tab: Tab) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-xs tracking-wide ${
        selected
          ? "border-[#f59e0b] text-[#f59e0b]"
          : "border-transparent text-[#a89070] hover:text-[#d6c3a3]"
      }`}
    >
      {children}
    </button>
  );
}
