"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { useDocument } from "@/hooks/useDocument";
import { clearBuilds } from "@/lib/builds-storage";
import { compileDocument } from "@/lib/compile";
import { addMember, deleteMember, duplicateMembers, groupMembers, resizeMemberCut, setComponentPose, setPlacementPose, type NewMemberInput } from "@/lib/edit";
import { parseInstanceKey } from "@/lib/fasteners";
import { groupOrigin, placementAfterReseat, placementInNewGroup, unionAabb, worldPlacementPose, type Vec3 } from "@/lib/geometry";
import type { SceneComponent, SceneMemberInstance, SceneModel } from "@/lib/scene";
import { localShiftForWorldX } from "@/lib/geometry/pose";
import { EMPTY_SELECTION, pruneSelection, selectAdded, selectAll, selectKeys, selectMember, type Selection } from "@/lib/selection";
import {
  EXPORT_CAMERAS_KEY,
  readExportCameras,
  snapshotExportCamera,
  writeExportCameras,
  type ExportCamera,
  type ViewportExportApi,
} from "@/lib/export-view";
import { composeSheet, exportSheetFilename, layoutSheet, overallDimensions } from "@/lib/export-sheet";
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
const EXPORT_CAMERAS_EVENT = "truecuts-export-cameras";

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

function subscribeExportCameras(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(EXPORT_CAMERAS_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(EXPORT_CAMERAS_EVENT, handler);
  };
}

function exportCamerasSnapshot() {
  return window.localStorage.getItem(EXPORT_CAMERAS_KEY) ?? "";
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

type ComponentPoseUpdate = {
  componentId: string;
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
  const [hoveredKeys, setHoveredKeys] = useState<string[]>([]);
  const [activeConnectionKey, setActiveConnectionKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [libraryEpoch, setLibraryEpoch] = useState(0);
  const sidebarRef = usePanelRef();
  const storedPreferences = useSyncExternalStore(subscribePreferences, preferencesSnapshot, () => "");
  const preferences = readPreferences(storedPreferences || null);
  const storedExportCameras = useSyncExternalStore(subscribeExportCameras, exportCamerasSnapshot, () => "");
  const exportCameras = readExportCameras(storedExportCameras || null);
  const exportApiRef = useRef<ViewportExportApi | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
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

  const setExportCameras = useCallback((cameras: ExportCamera[]) => {
    window.localStorage.setItem(EXPORT_CAMERAS_KEY, writeExportCameras(cameras));
    window.dispatchEvent(new Event(EXPORT_CAMERAS_EVENT));
  }, []);

  const handleSelect = useCallback((key: string | null, options?: { shift?: boolean }) => {
    setHoveredKeys([]);
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

  const handleSelectKeys = useCallback((keys: string[], mode?: Selection["mode"]) => {
    setHoveredKeys([]);
    const current = selectionRef.current;
    const next = selectKeys(current, keys, mode);
    if (next === current) return;
    setActiveConnectionKey(null);
    selectionRef.current = next;
    setStoredSelection(next);
  }, []);

  const handleMarqueeSelect = useCallback((keys: string[]) => {
    setHoveredKeys([]);
    const current = selectionRef.current;
    const next = selectAdded(current, keys);
    if (next === current) return;
    setActiveConnectionKey(null);
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
        setHoveredKeys([]);
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

  const handleResizeMember = useCallback((update: { memberId: string; axis: 0 | 1 | 2; side: "start" | "end"; inches: number }): string | null => {
    try {
      const next = resizeMemberCut(textRef.current, update.memberId, update.axis, update.inches, update.side);
      if (next !== textRef.current) commit(next);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Could not resize the member";
    }
  }, [commit]);

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

  const handleChangeComponentPose = useCallback(
    (update: ComponentPoseUpdate) => {
      if (!compiled.document) return;
      try {
        const next = setComponentPose(text, update.componentId, update.position, update.rotation);
        if (next !== text) commit(next);
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
    setHoveredKeys([]);
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
        setHoveredKeys([]);
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
        return;
      }
      if (key === "g" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const keys = selectionRef.current.keys;
        const scene = compiledRef.current.scene;
        if (keys.length === 0 || !scene) return;
        try {
          const grouped = groupFromSelection(textRef.current, scene, keys);
          if (!grouped || grouped.text === textRef.current) return;
          commit(grouped.text);
          const members =
            compileDocument(grouped.text).scene?.components.find((component) => component.id === grouped.componentId)
              ?.members ?? [];
          const next: Selection =
            members.length > 1
              ? { keys: members.map((member) => member.key), mode: "multi" }
              : members.length === 1
                ? { keys: [members[0].key], mode: "single" }
                : EMPTY_SELECTION;
          selectionRef.current = next;
          setStoredSelection(next);
          setHoveredKeys([]);
          setActiveConnectionKey(null);
        } catch {
          // Leave the YAML alone if the group cannot be written.
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [commit, handleSelect, redo, undo]);

  const buildBounds = useMemo(() => {
    const scene = compiled.scene;
    if (!scene) return null;
    return unionAabb(scene.components.flatMap((component) => component.members.map((part) => part.worldBounds)));
  }, [compiled.scene]);
  const exportTitle = compiled.scene?.name ?? compiled.document?.name ?? "Untitled";
  const exportDimensions = buildBounds ? overallDimensions(buildBounds) : "Fix the build to measure it.";

  const handleUseCurrentCamera = useCallback(
    (id: string) => {
      const orbit = exportApiRef.current?.readOrbit();
      if (!orbit) {
        setExportError("The view is not ready yet.");
        return;
      }
      setExportError(null);
      const current = readExportCameras(window.localStorage.getItem(EXPORT_CAMERAS_KEY));
      setExportCameras(current.map((camera) => (camera.id === id ? snapshotExportCamera(camera, orbit) : camera)));
    },
    [setExportCameras],
  );

  const handlePreviewCamera = useCallback(
    (camera: ExportCamera) => {
      if (!buildBounds) {
        setExportError("Fix the build to frame a camera.");
        return;
      }
      if (!exportApiRef.current) {
        setExportError("The view is not ready yet.");
        return;
      }
      setExportError(null);
      exportApiRef.current.preview(camera, buildBounds);
    },
    [buildBounds],
  );

  const handleDownloadSheet = useCallback(async () => {
    const bounds = buildBounds;
    const api = exportApiRef.current;
    const cameras = readExportCameras(window.localStorage.getItem(EXPORT_CAMERAS_KEY));
    if (!bounds || cameras.length === 0) return;
    if (!api) {
      setExportError("The view is not ready yet.");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const layout = layoutSheet(cameras.length);
      if (layout.cells.length === 0) return;
      const shots = await api.capture(
        cameras,
        bounds,
        layout.cells.map((cell) => ({
          width: Math.max(1, Math.round(cell.image.width)),
          height: Math.max(1, Math.round(cell.image.height)),
        })),
      );
      if (document.fonts?.ready) await document.fonts.ready;
      const sheet = composeSheet({
        title: exportTitle,
        dimensions: overallDimensions(bounds),
        views: cameras.map((camera, index) => ({ name: camera.name, image: shots[index]! })),
      });
      const blob = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode the sheet");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportSheetFilename(exportTitle);
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Could not export the sheet");
    } finally {
      setExporting(false);
    }
  }, [buildBounds, exportTitle]);

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
            title="Catalog, builds, export, and settings"
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
            onSelectKeys={handleSelectKeys}
            onHover={setHoveredKeys}
            activeConnectionKey={activeConnectionKey}
            onActiveConnection={setActiveConnectionKey}
            boreDiameter={preferences.boreDiameter}
          />
        </Panel>
        <Separator className="w-1.5 bg-[#3d2a18] hover:bg-[#d97706]" />
        <Panel id="viewport" minSize="28%">
          <Viewport
            scene={compiled.scene}
            selectedKeys={selection.keys}
            selectionMode={selection.mode}
            hoveredKeys={hoveredKeys}
            onSelect={handleSelect}
            onMarqueeSelect={handleMarqueeSelect}
            onDeleteMembers={handleDeleteMembers}
            onChangePoses={handleChangePoses}
            onChangeComponentPose={handleChangeComponentPose}
            activeConnection={
              compiled.scene?.connections.find((connection) => connection.key === activeConnectionKey) ?? null
            }
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            showContacts={preferences.showContacts}
            onShowContacts={(showContacts) => setPreferences((current) => ({ ...current, showContacts }))}
            showUnattached={preferences.showUnattached}
            onShowUnattached={(showUnattached) => setPreferences((current) => ({ ...current, showUnattached }))}
            fineSnap={preferences.fineSnap}
            boreDiameter={preferences.boreDiameter}
            onPlaceMember={handlePlaceMember}
            members={compiled.document?.members}
            onResizeMember={handleResizeMember}
            exportApiRef={exportApiRef}
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
              setHoveredKeys([]);
              setActiveConnectionKey(null);
            }}
            onClose={toggleSidebar}
            preferences={preferences}
            onPreferences={setPreferences}
            onFactoryReset={factoryReset}
            libraryEpoch={libraryEpoch}
            exportCameras={exportCameras}
            exportTitle={exportTitle}
            exportDimensions={exportDimensions}
            canExport={buildBounds !== null && exportCameras.length > 0}
            exporting={exporting}
            exportError={exportError}
            onExportCameras={setExportCameras}
            onUseCurrentCamera={handleUseCurrentCamera}
            onPreviewCamera={handlePreviewCamera}
            onDownloadSheet={() => void handleDownloadSheet()}
          />
        </Panel>
      </Group>
    </div>
  );
}

function groupFromSelection(text: string, scene: SceneModel, keys: string[]) {
  const selected = new Set(keys);
  const byKey = new Map<string, { part: SceneMemberInstance; component: SceneComponent }>();
  for (const component of scene.components) {
    for (const part of component.members) byKey.set(part.key, { part, component });
  }
  const ordered = keys.flatMap((key) => {
    const hit = byKey.get(key);
    return hit ? [hit] : [];
  });
  if (ordered.length === 0) return null;
  const origin = groupOrigin(ordered.map(({ part }) => part.worldBounds));
  if (!origin) return null;
  const sole = new Set(ordered.map(({ component }) => component.id)).size === 1 ? ordered[0].component : null;
  const entire = Boolean(
    sole && sole.members.length === ordered.length && sole.members.every((member) => selected.has(member.key)),
  );
  const items = ordered.map(({ part, component }) => {
    const world = worldPlacementPose(
      { position: part.position, rotation: part.rotation },
      { position: component.position, rotation: component.rotation },
    );
    const { componentId, placementIndex } = parseInstanceKey(part.key);
    if (entire) {
      return {
        componentId,
        placementIndex,
        position: placementAfterReseat(world.position, origin, component.rotation),
        rotation: part.rotation,
      };
    }
    const local = placementInNewGroup(world, origin);
    return { componentId, placementIndex, position: local.position, rotation: local.rotation };
  });
  return groupMembers(text, items, origin, entire && sole ? sole.id : undefined);
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
