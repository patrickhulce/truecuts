"use client";

import { useRef, useState } from "react";
import { applyImport, buildsExportFilename, BuildsFileError, parseBuildsFile, serializeBuilds, type BuildRecord } from "@/lib/builds";
import { replaceAllBuilds } from "@/lib/builds-storage";
import { type Preferences } from "@/lib/preferences";

type SettingsTabProps = {
  text: string;
  name: string;
  builds: BuildRecord[];
  onRefresh: () => Promise<void>;
  onLoadBuild: (yaml: string) => void;
  preferences: Preferences;
  onPreferences: (preferences: Preferences) => void;
  onFactoryReset: () => void;
};

function download(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "build";
}

export function SettingsTab({
  text,
  name,
  builds,
  onRefresh,
  onLoadBuild,
  preferences,
  onPreferences,
  onFactoryReset,
}: SettingsTabProps) {
  const importRef = useRef<HTMLInputElement>(null);
  const yamlRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importText(raw: string) {
    setError(null);
    setMessage(null);
    try {
      const incoming = parseBuildsFile(raw);
      const next = applyImport(builds, incoming, mode);
      await replaceAllBuilds(next);
      await onRefresh();
      setMessage(
        mode === "replace"
          ? `Replaced saved builds with ${incoming.length} from the file.`
          : `Imported ${incoming.length} build${incoming.length === 1 ? "" : "s"}.`,
      );
    } catch (cause) {
      setError(cause instanceof BuildsFileError || cause instanceof Error ? cause.message : "Could not import builds");
    }
  }

  async function importFile(file: File) {
    const raw = await file.text();
    await importText(raw);
  }

  function openYaml(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onLoadBuild(reader.result);
    };
    reader.readAsText(file);
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-6">
      <SectionTitle>Backup</SectionTitle>
      <p className="text-xs leading-relaxed text-[#a89070]">
        Download every saved build, or bring a backup back onto this device.
      </p>
      <button
        type="button"
        onClick={() => download(buildsExportFilename(), serializeBuilds(builds), "application/json")}
        className="mt-3 cursor-pointer rounded border border-[#6b4a2b] bg-[#1a120b] px-3 py-2 text-sm text-[#f59e0b] hover:border-[#f59e0b]"
      >
        Download all builds (.json)
      </button>

      <div className="mt-3 flex gap-2 text-[11px]">
        <ModeButton label="Merge with existing" selected={mode === "merge"} onClick={() => setMode("merge")} />
        <ModeButton label="Replace all" selected={mode === "replace"} onClick={() => setMode("replace")} />
      </div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files[0];
          if (file) void importFile(file);
        }}
        className={`mt-2 rounded border border-dashed px-3 py-4 text-center text-xs ${
          dragOver ? "border-[#f59e0b] text-[#f59e0b]" : "border-[#3d2a18] text-[#a89070]"
        }`}
      >
        Drop a builds .json file here
        <div className="mt-2">
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="cursor-pointer rounded border border-[#3d2a18] px-2.5 py-1 text-[#d6c3a3] hover:border-[#6b4a2b]"
          >
            Choose file
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>

      <SectionTitle>Current document</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => download(`${fileSlug(name)}.yaml`, text, "application/yaml")}
          className="cursor-pointer rounded border border-[#3d2a18] px-2.5 py-1 text-xs text-[#d6c3a3] hover:border-[#f59e0b] hover:text-[#f59e0b]"
        >
          Download current build as .yaml
        </button>
        <button
          type="button"
          onClick={() => yamlRef.current?.click()}
          className="cursor-pointer rounded border border-[#3d2a18] px-2.5 py-1 text-xs text-[#d6c3a3] hover:border-[#f59e0b] hover:text-[#f59e0b]"
        >
          Open local .yaml file
        </button>
        <input
          ref={yamlRef}
          type="file"
          accept=".yaml,.yml,text/yaml"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) openYaml(file);
          }}
        />
      </div>

      <SectionTitle>Preferences</SectionTitle>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-[#d6c3a3]">
        <input
          type="checkbox"
          checked={preferences.fineSnap}
          onChange={(event) => onPreferences({ ...preferences, fineSnap: event.target.checked })}
          className="mt-0.5 accent-[#f59e0b]"
        />
        <span>
          Fine snap
          <span className="mt-0.5 block text-[11px] text-[#8a7355]">1/16″ and 15°. Off uses 1/2″ and 45°.</span>
        </span>
      </label>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-[#d6c3a3]">
        <input
          type="checkbox"
          checked={preferences.showContacts}
          onChange={(event) => onPreferences({ ...preferences, showContacts: event.target.checked })}
          className="mt-0.5 accent-[#f59e0b]"
        />
        <span>
          Show contacts
          <span className="mt-0.5 block text-[11px] text-[#8a7355]">Contact patches on the selected member.</span>
        </span>
      </label>

      <SectionTitle>Reset</SectionTitle>
      <button
        type="button"
        onClick={() => {
          if (
            !window.confirm(
              "Reset TrueCuts? This restores the demo build, clears undo history, and deletes every saved build on this device.",
            )
          ) {
            return;
          }
          onFactoryReset();
        }}
        className="cursor-pointer rounded border border-rose-400/50 px-2.5 py-1 text-xs text-rose-400 hover:border-rose-400"
      >
        Reset app data
      </button>
      {error ? <p className="pt-3 text-xs text-rose-400">{error}</p> : null}
      {message ? <p className="pt-3 text-xs text-[#d6c3a3]">{message}</p> : null}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="pb-2 pt-4 text-[10px] uppercase tracking-widest text-[#8a7355]">{children}</h2>;
}

function ModeButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`cursor-pointer rounded border px-2 py-1 ${
        selected ? "border-[#f59e0b] text-[#f59e0b]" : "border-[#3d2a18] text-[#a89070] hover:text-[#d6c3a3]"
      }`}
    >
      {label}
    </button>
  );
}
