"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useDocument } from "@/hooks/useDocument";
import { deletePart, setPlacementPose } from "@/lib/edit";
import type { Vec3 } from "@/lib/geometry";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { YamlEditor } from "./YamlEditor";

const Viewport = dynamic(() => import("./Viewport").then((mod) => mod.Viewport), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#1a120b] text-sm text-[#a89070]">
      Laying out the shop…
    </div>
  ),
});

const headerButtonClass =
  "rounded border border-[#6b4a2b] bg-[#1a120b] px-2.5 py-1 text-[#d6c3a3] hover:border-[#f59e0b] hover:text-[#f59e0b] disabled:cursor-not-allowed disabled:border-[#3d2a18] disabled:text-[#8a7355] disabled:hover:border-[#3d2a18] disabled:hover:text-[#8a7355]";

export function Workspace() {
  const { text, setText, commit, compiled, reset, undo, redo, canUndo, canRedo } = useDocument();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const partCount = compiled.document?.parts.length ?? 0;
  const componentCount = compiled.document?.components.length ?? 0;
  const errorCount = compiled.diagnostics.filter((item) => item.severity === "error").length;

  const handleDeletePart = useCallback(
    (partId: string) => {
      if (!compiled.document) return;
      try {
        commit(deletePart(text, partId));
        setSelectedKey(null);
      } catch {
        // Leave the YAML alone if the AST cannot be updated.
      }
    },
    [commit, compiled.document, text],
  );

  const handleChangePose = useCallback(
    (componentId: string, placementIndex: number, position: Vec3, rotation: Vec3) => {
      if (!compiled.document) return;
      try {
        commit(setPlacementPose(text, componentId, placementIndex, position, rotation));
      } catch {
        // Leave the YAML alone if the AST cannot be updated.
      }
    },
    [commit, compiled.document, text],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (key === "y" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [redo, undo]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-[#3d2a18] bg-[#241a10] px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[#f59e0b]">
            TrueCuts
          </h1>
          <p className="hidden text-sm text-[#a89070] sm:block">Plan the cut. Trust the fit.</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#a89070]">
          <span>
            {compiled.scene?.name ?? compiled.document?.name ?? "Untitled"}
            {errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? "" : "s"}` : ""}
          </span>
          <span className="hidden sm:inline">
            {partCount} part{partCount === 1 ? "" : "s"} · {componentCount} component
            {componentCount === 1 ? "" : "s"}
          </span>
          <button type="button" onClick={undo} disabled={!canUndo} className={headerButtonClass}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} className={headerButtonClass}>
            Redo
          </button>
          <button type="button" onClick={reset} className={headerButtonClass}>
            Reset demo
          </button>
        </div>
      </header>
      <Group orientation="horizontal" className="min-h-0 flex-1" defaultLayout={{ editor: 40, viewport: 60 }}>
        <Panel id="editor" minSize={22} className="flex min-h-0 flex-col bg-[#1a120b]">
          <div className="min-h-0 flex-1">
            <YamlEditor value={text} onChange={setText} diagnostics={compiled.diagnostics} />
          </div>
          <DiagnosticsPanel diagnostics={compiled.diagnostics} />
        </Panel>
        <Separator className="w-1.5 bg-[#3d2a18] hover:bg-[#d97706]" />
        <Panel id="viewport" minSize={30}>
          <Viewport
            scene={compiled.scene}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onDeletePart={handleDeletePart}
            onChangePose={handleChangePose}
          />
        </Panel>
      </Group>
    </div>
  );
}
