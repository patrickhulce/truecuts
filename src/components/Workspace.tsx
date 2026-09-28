"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { useDocument } from "@/hooks/useDocument";
import { clearBuilds } from "@/lib/builds-storage";
import { compileDocument } from "@/lib/compile";
import { addMember, deleteMember, duplicateMembers, setPlacementPose, type NewMemberInput } from "@/lib/edit";
import { parseInstanceKey } from "@/lib/fasteners";
import { unionAabb, type Vec3 } from "@/lib/geometry";
import { localShiftForWorldX } from "@/lib/geometry/pose";
import { EMPTY_SELECTION, pruneSelection, selectAll, selectMember, type Selection } from "@/lib/selection";
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

type ClipboardItem = {
  memberId: string;
  componentId: string;
  /** 0-based occurrence of this member id in the component. */
  occurrence: number;
  position: Vec3;
  rotation: Vec3;
};

type Clipboard = {
  items: ClipboardItem[];
  worldSpanX: number;
};

type PoseUpdate = {
  componentId: string;
  placementIndex: number;
  position: Vec3;
  rotation: Vec3;
};

export function Workspace() {
  const { text, setText, commit, compiled, reset, undo, redo, canUndo, canRedo } = useDocument();
  const [storedSelection, setStoredSelection] = useState<Selection>(EMPTY_SELECTION);
  const selection = useMemo(() => {
    const scene = compiled.scene;
    if (!scene) return storedSelection;
    const live = new Set(scene.components.flatMap((component) => component.members.map((member) => member.key)));
    return pruneSelection(storedSelection, live);
  }, [compiled.scene, storedSelection]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [activeConnectionKey, setActiveConnectionKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [libraryEpoch, setLibraryEpoch] = useState(0);
  const sidebarRef = usePanelRef();
  const storedPreferences = useSyncExternalStore(subscribePreferences, preferencesSnapshot, () => "");
  const preferences = readPreferences(storedPreferences || null);
  const selectionRef = useRef(selection);
  const textRef = useRef(text);
  const compiledRef = useRef(compiled);
  const clipboardRef = useRef<Clipboard | null>(null);
  useEffect(() => {
    selectionRef.current = selection;
    textRef.current = text;
    compiledRef.current = compiled;
  }, [compiled, selection, text]);

  const setPreferences = useCallback((next: Preferences | ((current: Preferences) => Preferences)) => {
    const current = readPreferences(window.localStorage.getItem(PREFERENCES_KEY));
    const resolved = typeof next === "function" ? next(current) : next;
    window.localStorage.setItem(PREFERENCES_KEY, writePreferences(resolved));
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
  }, []);

  const handleSelect = useCallback((key: string | null, options?: { shift?: boolean }) => {
    setHoveredKey(null);
    const current = selectionRef.current;
    const next = key === null ? EMPTY_SELECTION : selectMember(current, key, Boolean(options?.shift));
    const unchangedSingle =
      next.mode === "single" &&
      current.mode === "single" &&
      next.keys.length === 1 &&
      current.keys.length === 1 &&
      next.keys[0] === current.keys[0];
    if (!unchangedSingle) setActiveConnectionKey(null);
    selectionRef.current = next;
    setStoredSelection(next);
  }, []);
  const memberCount = compiled.document?.members.length ?? 0;
  const componentCount = compiled.document?.components.length ?? 0;
  const errorCount = compiled.diagnostics.filter((item) => item.severity === "error").length;

  const handleDeleteMembers = useCallback(
    (memberIds: string[]) => {
      if (!compiled.document || memberIds.length === 0) return;
      try {
        const seen = new Set<string>();
        let next = text;
        for (const memberId of memberIds) {
          if (seen.has(memberId)) continue;
          seen.add(memberId);
          next = deleteMember(next, memberId);
        }
        commit(next);
        setHoveredKey(null);
        setActiveConnectionKey(null);
        selectionRef.current = EMPTY_SELECTION;
        setStoredSelection(EMPTY_SELECTION);
      } catch {
        // Leave the YAML alone if the AST cannot be updated.
      }
    },
    [commit, compiled.document, text],
  );

  const handlePlaceMember = useCallback(
    (input: NewMemberInput, position: Vec3) => {
      let componentId: string | undefined;
      const selected = selectionRef.current.keys.at(-1);
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

  const handleChangePoses = useCallback(
    (updates: PoseUpdate[]) => {
      if (!compiled.document || updates.length === 0) return;
      try {
        let next = text;
        for (const update of updates) {
          next = setPlacementPose(next, update.componentId, update.placementIndex, update.position, update.rotation);
        }
        commit(next);
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
    selectionRef.current = EMPTY_SELECTION;
    setStoredSelection(EMPTY_SELECTION);
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
        return;
      }
      if (isTextField(event.target) || event.repeat) return;
      if (key === "a" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const keys =
          compiledRef.current.scene?.components.flatMap((component) =>
            component.members.map((member) => member.key),
          ) ?? [];
        const next = selectAll(keys);
        selectionRef.current = next;
        setStoredSelection(next);
        setHoveredKey(null);
        setActiveConnectionKey(null);
        return;
      }
      if (key === "c" && !event.shiftKey && !event.altKey) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim()) return;
        const keys = selectionRef.current.keys;
        const scene = compiledRef.current.scene;
        const document = compiledRef.current.document;
        if (keys.length === 0 || !scene) return;
        const instances = scene.components
          .flatMap((component) => component.members)
          .filter((member) => keys.includes(member.key));
        const span = unionAabb(instances.map((instance) => instance.worldBounds));
        if (instances.length === 0 || !span) return;
        event.preventDefault();
        clipboardRef.current = {
          worldSpanX: span.max[0] - span.min[0],
          items: instances.map((instance) => {
            const { componentId, memberId, placementIndex } = parseInstanceKey(instance.key);
            const placements = document?.components.find((entry) => entry.id === componentId)?.members ?? [];
            let occurrence = 0;
            for (let index = 0; index < placementIndex && index < placements.length; index += 1) {
              if (placements[index].id === memberId) occurrence += 1;
            }
            return {
              memberId,
              componentId,
              occurrence,
              position: [instance.position[0], instance.position[1], instance.position[2]],
              rotation: [instance.rotation[0], instance.rotation[1], instance.rotation[2]],
            };
          }),
        };
        return;
      }
      if (key === "v" && !event.shiftKey && !event.altKey) {
        const copied = clipboardRef.current;
        const scene = compiledRef.current.scene;
        const document = compiledRef.current.document;
        if (!copied || copied.items.length === 0 || !scene || !document) return;
        event.preventDefault();
        try {
          const before = new Set(document.members.map((member) => member.id));
          const items = copied.items.flatMap((item) => {
            const component = scene.components.find((entry) => entry.id === item.componentId);
            if (!component) return [];
            const delta = localShiftForWorldX(component.rotation, copied.worldSpanX + 1);
            const position: Vec3 = [
              item.position[0] + delta[0],
              item.position[1] + delta[1],
              item.position[2] + delta[2],
            ];
            return [{ ...item, position }];
          });
          if (items.length === 0) return;
          const next = duplicateMembers(textRef.current, items);
          if (next === textRef.current) return;
          commit(next);
          const added =
            compileDocument(next).scene?.components
              .flatMap((item) => item.members)
              .filter((member) => !before.has(member.memberId)) ?? [];
          const pasted: Selection =
            added.length > 1
              ? { keys: added.map((member) => member.key), mode: "multi" }
              : added.length === 1
                ? { keys: [added[0].key], mode: "single" }
                : EMPTY_SELECTION;
          selectionRef.current = pasted;
          setStoredSelection(pasted);
          setActiveConnectionKey(null);
        } catch {
          // Leave the YAML alone if the member cannot be copied.
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [commit, handleSelect, redo, undo]);

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
            selectedKeys={selection.keys}
            selectionMode={selection.mode}
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
            selectedKeys={selection.keys}
            selectionMode={selection.mode}
            hoveredKey={hoveredKey}
            onSelect={handleSelect}
            onDeleteMembers={handleDeleteMembers}
            onChangePoses={handleChangePoses}
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
              selectionRef.current = EMPTY_SELECTION;
              setStoredSelection(EMPTY_SELECTION);
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

function isTextField(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  if (element.closest(".cm-editor")) return true;
  return element.closest("input, textarea, [contenteditable='true']") !== null;
}

function SidePanelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 4v16" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
