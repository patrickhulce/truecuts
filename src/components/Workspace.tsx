"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { useDocument } from "@/hooks/useDocument";
import { clearBuilds } from "@/lib/builds-storage";
import { compileDocument } from "@/lib/compile";
import { addMember, deleteMember, setPlacementPose, type NewMemberInput } from "@/lib/edit";
import { parseInstanceKey } from "@/lib/fasteners";
import type { Vec3 } from "@/lib/geometry";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  readPreferences,
  writePreferences,
  type Preferences,
} from "@/lib/preferences";
import { EditorPanel } from "./EditorPanel";
import { RightPanel } from "./RightPanel";

const Viewport = dynamic(() => import("./Viewport").then((mod) => mod.Viewport), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#1a120b] text-sm text-[#a89070]">
      Laying out the shop…
    </div>
  ),
});

const headerButtonClass =
  "grid h-8 w-8 cursor-pointer place-items-center rounded border border-[#6b4a2b] bg-[#1a120b] text-[#d6c3a3] hover:border-[#f59e0b] hover:text-[#f59e0b]";

const PREFERENCES_EVENT = "truecuts-preferences";

function subscribePreferences(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(PREFERENCES_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(PREFERENCES_EVENT, handler);
  };
}

function preferencesSnapshot() {
  return window.localStorage.getItem(PREFERENCES_KEY) ?? "";
}

export function Workspace() {
  const { text, setText, commit, compiled, reset, undo, redo, canUndo, canRedo } = useDocument();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [activeConnectionKey, setActiveConnectionKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [libraryEpoch, setLibraryEpoch] = useState(0);
  const sidebarRef = usePanelRef();
  const storedPreferences = useSyncExternalStore(subscribePreferences, preferencesSnapshot, () => "");
  const preferences = readPreferences(storedPreferences || null);
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  const setPreferences = useCallback((next: Preferences | ((current: Preferences) => Preferences)) => {
    const current = readPreferences(window.localStorage.getItem(PREFERENCES_KEY));
    const resolved = typeof next === "function" ? next(current) : next;
    window.localStorage.setItem(PREFERENCES_KEY, writePreferences(resolved));
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
  }, []);

  const handleSelect = useCallback((key: string | null) => {
    setHoveredKey(null);
    if (selectedKeyRef.current !== key) setActiveConnectionKey(null);
    setSelectedKey(key);
  }, []);
  const memberCount = compiled.document?.members.length ?? 0;
  const componentCount = compiled.document?.components.length ?? 0;
  const errorCount = compiled.diagnostics.filter((item) => item.severity === "error").length;

  const handleDeleteMember = useCallback(
    (memberId: string) => {
      if (!compiled.document) return;
      try {
        commit(deleteMember(text, memberId));
        setHoveredKey(null);
        setSelectedKey(null);
      } catch {
        // Leave the YAML alone if the AST cannot be updated.
      }
    },
    [commit, compiled.document, text],
  );

  const handlePlaceMember = useCallback(
    (input: NewMemberInput, position: Vec3) => {
      let componentId: string | undefined;
      const selected = selectedKeyRef.current;
      if (selected && compiled.document) {
        try {
          const parsed = parseInstanceKey(selected);
          if (compiled.document.components.some((component) => component.id === parsed.componentId)) {
            componentId = parsed.componentId;
          }
        } catch {
          componentId = undefined;
        }
      }
      try {
        const before = new Set(compiled.document?.members.map((member) => member.id) ?? []);
        const next = addMember(text, {
          label: input.label,
          stock: input.stock,
          size: input.size,
          cuts: input.cuts,
          componentId,
          position,
          rotation: [0, 0, 0],
        });
        commit(next);
        const added = compileDocument(next).scene?.components
          .flatMap((component) => component.members)
          .find((member) => !before.has(member.memberId));
        if (added) handleSelect(added.key);
      } catch {
        // Leave the YAML alone if the member cannot be added.
      }
    },
    [commit, compiled.document, handleSelect, text],
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

  const toggleSidebar = useCallback(() => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setSidebarOpen(true);
    } else {
      panel.collapse();
      setSidebarOpen(false);
    }
  }, [sidebarRef]);

  const factoryReset = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    reset();
    void clearBuilds().finally(() => setLibraryEpoch((epoch) => epoch + 1));
    setSelectedKey(null);
    setHoveredKey(null);
    setActiveConnectionKey(null);
  }, [reset, setPreferences]);

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
            {memberCount} {memberCount === 1 ? "member" : "members"} · {componentCount}{" "}
            {componentCount === 1 ? "component" : "components"}
          </span>
          <button
            type="button"
            aria-label="Toggle side panel"
            aria-pressed={sidebarOpen}
            title="Catalog, builds, and settings"
            onClick={toggleSidebar}
            className={`${headerButtonClass} ${sidebarOpen ? "border-[#f59e0b] text-[#f59e0b]" : ""}`}
          >
            <SidePanelIcon />
          </button>
        </div>
      </header>
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={{ editor: 34, viewport: 42, sidebar: 24 }}
      >
        <Panel id="editor" minSize="20%" className="flex min-h-0 flex-col bg-[#1a120b]">
          <EditorPanel
            text={text}
            onChangeText={setText}
            onCommit={commit}
            compiled={compiled}
            selectedKey={selectedKey}
            onSelect={handleSelect}
            onHover={setHoveredKey}
            activeConnectionKey={activeConnectionKey}
            onActiveConnection={setActiveConnectionKey}
          />
        </Panel>
        <Separator className="w-1.5 bg-[#3d2a18] hover:bg-[#d97706]" />
        <Panel id="viewport" minSize="28%">
          <Viewport
            scene={compiled.scene}
            selectedKey={selectedKey}
            hoveredKey={hoveredKey}
            onSelect={handleSelect}
            onDeleteMember={handleDeleteMember}
            onChangePose={handleChangePose}
            activeConnection={
              compiled.scene?.connections.find((connection) => connection.key === activeConnectionKey) ?? null
            }
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            showContacts={preferences.showContacts}
            onShowContacts={(showContacts) => setPreferences((current) => ({ ...current, showContacts }))}
            fineSnap={preferences.fineSnap}
            onPlaceMember={handlePlaceMember}
          />
        </Panel>
        <Separator className="w-1.5 bg-[#3d2a18] hover:bg-[#d97706]" />
        <Panel
          id="sidebar"
          panelRef={sidebarRef}
          collapsible
          collapsedSize={0}
          minSize="18%"
          onResize={(size) => {
            const open = size.asPercentage > 1;
            setSidebarOpen((current) => (current === open ? current : open));
          }}
          className="flex min-h-0 flex-col bg-[#1a120b]"
        >
          <RightPanel
            text={text}
            compiled={compiled}
            onCommit={commit}
            onLoadBuild={(yaml) => {
              commit(yaml);
              setSelectedKey(null);
              setHoveredKey(null);
              setActiveConnectionKey(null);
            }}
            onClose={toggleSidebar}
            preferences={preferences}
            onPreferences={setPreferences}
            onFactoryReset={factoryReset}
            libraryEpoch={libraryEpoch}
          />
        </Panel>
      </Group>
    </div>
  );
}

function SidePanelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 4v16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
