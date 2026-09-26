"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { type BuildRecord } from "@/lib/builds";
import { loadSavedBuilds } from "@/lib/builds-storage";
import type { CompileResult } from "@/lib/compile";
import { type Preferences } from "@/lib/preferences";
import { BuildsTab } from "./BuildsTab";
import { CatalogTab } from "./CatalogTab";
import { SettingsTab } from "./SettingsTab";

type Tab = "catalog" | "builds" | "settings";

type RightPanelProps = {
  text: string;
  compiled: CompileResult;
  onCommit: (value: string) => void;
  onLoadBuild: (yaml: string) => void;
  onClose: () => void;
  preferences: Preferences;
  onPreferences: (preferences: Preferences) => void;
  onFactoryReset: () => void;
  libraryEpoch: number;
};

export function RightPanel({
  text,
  compiled,
  onCommit,
  onLoadBuild,
  onClose,
  preferences,
  onPreferences,
  onFactoryReset,
  libraryEpoch,
}: RightPanelProps) {
  const [tab, setTab] = useState<Tab>("catalog");
  const [builds, setBuilds] = useState<BuildRecord[]>([]);
  const refresh = useCallback(async () => {
    setBuilds(await loadSavedBuilds());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSavedBuilds()
      .then((rows) => {
        if (!cancelled) setBuilds(rows);
      })
      .catch(() => {
        if (!cancelled) setBuilds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryEpoch]);

  const name = compiled.document?.name ?? compiled.scene?.name ?? "Untitled";
  const memberCount = compiled.document?.members.length ?? 0;
  const componentCount = compiled.document?.components.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start border-b border-[#3d2a18] bg-[#241a10]">
        <div role="tablist" aria-label="Side panel" className="flex flex-wrap items-center px-1">
          <TabButton id="catalog" selected={tab === "catalog"} onSelect={setTab}>
            Catalog
          </TabButton>
          <TabButton id="builds" selected={tab === "builds"} onSelect={setTab}>
            Builds
          </TabButton>
          <TabButton id="settings" selected={tab === "settings"} onSelect={setTab}>
            Settings
          </TabButton>
        </div>
        <button
          type="button"
          aria-label="Close side panel"
          title="Close side panel"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded text-[#a89070] hover:text-[#f59e0b]"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {tab === "catalog" ? <CatalogTab text={text} onCommit={onCommit} /> : null}
        {tab === "builds" ? (
          <BuildsTab
            text={text}
            name={name}
            memberCount={memberCount}
            componentCount={componentCount}
            builds={builds}
            onRefresh={refresh}
            onLoadBuild={onLoadBuild}
          />
        ) : null}
        {tab === "settings" ? (
          <SettingsTab
            text={text}
            name={name}
            builds={builds}
            onRefresh={refresh}
            onLoadBuild={onLoadBuild}
            preferences={preferences}
            onPreferences={onPreferences}
            onFactoryReset={onFactoryReset}
          />
        ) : null}
      </div>
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
      className={`-mb-px shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-2.5 py-2 text-xs tracking-wide ${
        selected ? "border-[#f59e0b] text-[#f59e0b]" : "border-transparent text-[#a89070] hover:text-[#d6c3a3]"
      }`}
    >
      {children}
    </button>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
