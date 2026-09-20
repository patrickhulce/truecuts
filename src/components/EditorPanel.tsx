"use client";

import { useState, type ReactNode } from "react";
import type { CompileResult } from "@/lib/compile";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { PartsBrowser } from "./PartsBrowser";
import { YamlEditor } from "./YamlEditor";

type Tab = "parts" | "yaml";

type EditorPanelProps = {
  text: string;
  onChangeText: (value: string) => void;
  compiled: CompileResult;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onHover: (key: string | null) => void;
};

export function EditorPanel({ text, onChangeText, compiled, selectedKey, onSelect, onHover }: EditorPanelProps) {
  const [tab, setTab] = useState<Tab>("parts");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Editor views" className="flex border-b border-[#3d2a18] bg-[#241a10] px-2">
        <TabButton id="parts" selected={tab === "parts"} onSelect={setTab}>
          Parts
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
            selectedKey={selectedKey}
            onSelect={onSelect}
            onHover={onHover}
          />
        ) : (
          <div className="min-h-0 flex-1">
            <YamlEditor value={text} onChange={onChangeText} diagnostics={compiled.diagnostics} />
          </div>
        )}
      </div>
      <DiagnosticsPanel diagnostics={compiled.diagnostics} />
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
