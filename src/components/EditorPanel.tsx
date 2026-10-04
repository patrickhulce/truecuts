"use client";

import { useState, type ReactNode } from "react";
import type { CompileResult } from "@/lib/compile";
import { formatDocumentYaml } from "@/lib/edit";
import { parseInstanceKey } from "@/lib/fasteners";
import type { SelectionMode } from "@/lib/selection";
import type { SceneModel } from "@/lib/scene";
import { formatInches } from "@/lib/units";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { PartsBrowser } from "./PartsBrowser";
import { YamlEditor } from "./YamlEditor";

type Tab = "build" | "yaml";

type EditorPanelProps = {
  text: string;
  onChangeText: (value: string) => void;
  onCommit: (value: string) => void;
  compiled: CompileResult;
  selectedKeys: string[];
  selectionMode: SelectionMode;
  onSelect: (key: string | null, options?: { shift?: boolean }) => void;
  onSelectKeys: (keys: string[], mode?: SelectionMode) => void;
  onHover: (keys: string[]) => void;
  activeConnectionKey: string | null;
  onActiveConnection: (key: string | null) => void;
  boreDiameter: number;
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
  selectedKeys,
  selectionMode,
  onSelect,
  onSelectKeys,
  onHover,
  activeConnectionKey,
  onActiveConnection,
  boreDiameter,
}: EditorPanelProps) {
  const [tab, setTab] = useState<Tab>("build");

  function openComponent(id: string) {
    const component = compiled.scene?.components.find((item) => item.id === id);
    onSelectKeys(component?.members.map((member) => member.key) ?? [], "multi");
  }

  function selectTab(next: Tab) {
    if (next === "yaml") {
      const formatted = formatDocumentYaml(text);
      if (formatted !== text) onCommit(formatted);
    }
    setTab(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Editor views" className="flex border-b border-[#3d2a18] bg-[#241a10] px-2">
        <TabButton id="build" selected={tab === "build"} onSelect={selectTab}>
          Build
        </TabButton>
        <TabButton id="yaml" selected={tab === "yaml"} onSelect={selectTab}>
          YAML
        </TabButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {tab === "build" ? (
          <PartsBrowser
            scene={compiled.scene}
            document={compiled.document}
            text={text}
            onCommit={onCommit}
            selectedKeys={selectedKeys}
            selectionMode={selectionMode}
            onSelect={onSelect}
            onSelectKeys={onSelectKeys}
            onHover={onHover}
            onActiveConnection={onActiveConnection}
            onOpenComponent={openComponent}
            boreDiameter={boreDiameter}
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
