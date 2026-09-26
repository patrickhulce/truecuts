"use client";

import { useRef, useState } from "react";
import { deleteBuild, saveBuild } from "@/lib/builds-storage";
import { type BuildRecord } from "@/lib/builds";
import { BLANK_YAML, SAMPLE_BUILDS } from "@/lib/samples";

type BuildsTabProps = {
  text: string;
  name: string;
  memberCount: number;
  componentCount: number;
  builds: BuildRecord[];
  onRefresh: () => Promise<void>;
  onLoadBuild: (yaml: string) => void;
};

export function BuildsTab({
  text,
  name,
  memberCount,
  componentCount,
  builds,
  onRefresh,
  onLoadBuild,
}: BuildsTabProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveCurrent() {
    const nextName = nameRef.current?.value.trim() || name || "Untitled";
    setBusy(true);
    setError(null);
    try {
      await saveBuild({
        id: crypto.randomUUID(),
        name: nextName,
        yaml: text,
        updatedAt: Date.now(),
        memberCount,
      });
      await onRefresh();
      setStatus(`Saved "${nextName}".`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the build");
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(build: BuildRecord) {
    setError(null);
    try {
      await saveBuild({
        ...build,
        id: crypto.randomUUID(),
        name: `Copy of ${build.name}`,
        updatedAt: Date.now(),
      });
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not duplicate the build");
    }
  }

  async function remove(build: BuildRecord) {
    if (!window.confirm(`Delete "${build.name}"?`)) return;
    setError(null);
    try {
      await deleteBuild(build.id);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the build");
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => onLoadBuild(BLANK_YAML)}
          className="w-full cursor-pointer rounded border border-[#6b4a2b] bg-[#1a120b] px-3 py-2 text-sm text-[#f59e0b] hover:border-[#f59e0b]"
        >
          + Blank build
        </button>
      </div>

      <section className="mx-3 mt-3 rounded border border-[#3d2a18] p-3">
        <h2 className="font-[family-name:var(--font-display)] text-sm text-[#f59e0b]">Current build</h2>
        <p className="mt-1 text-[11px] text-[#8a7355]">
          {memberCount} {memberCount === 1 ? "member" : "members"} · {componentCount}{" "}
          {componentCount === 1 ? "component" : "components"}
        </p>
        <label className="mt-2 block text-[11px] text-[#a89070]">
          Name
          <input
            key={name}
            ref={nameRef}
            defaultValue={name}
            className="mt-1 w-full rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm text-[#d6c3a3]"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveCurrent()}
          disabled={busy}
          className="mt-2 cursor-pointer rounded border border-[#3d2a18] px-2.5 py-1 text-xs text-[#d6c3a3] hover:border-[#f59e0b] hover:text-[#f59e0b] disabled:cursor-not-allowed disabled:text-[#8a7355]"
        >
          Save build
        </button>
      </section>

      <SectionTitle>Saved builds</SectionTitle>
      {builds.length === 0 ? (
        <p className="px-3 text-xs text-[#8a7355]">No saved builds yet. Save the current document or load a sample.</p>
      ) : (
        <ul className="space-y-2 px-3">
          {builds.map((build) => (
            <li key={build.id} className="rounded border border-[#3d2a18] px-3 py-2">
              <div className="text-sm text-[#d6c3a3]">{build.name}</div>
              <div className="text-[11px] text-[#8a7355]">
                {build.memberCount} {build.memberCount === 1 ? "member" : "members"} · {formatUpdated(build.updatedAt)}
              </div>
              <div className="mt-2 flex gap-1.5">
                <SmallButton onClick={() => onLoadBuild(build.yaml)}>Load</SmallButton>
                <SmallButton onClick={() => void duplicate(build)}>Duplicate</SmallButton>
                <SmallButton onClick={() => void remove(build)}>Delete</SmallButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Samples</SectionTitle>
      <ul className="space-y-2 px-3">
        {SAMPLE_BUILDS.map((sample) => (
          <li key={sample.id} className="rounded border border-[#3d2a18] px-3 py-2">
            <div className="text-sm text-[#d6c3a3]">{sample.name}</div>
            <p className="mt-0.5 text-[11px] leading-snug text-[#8a7355]">{sample.description}</p>
            <button
              type="button"
              onClick={() => onLoadBuild(sample.yaml)}
              className="mt-2 cursor-pointer rounded border border-[#3d2a18] px-2.5 py-1 text-xs text-[#d6c3a3] hover:border-[#f59e0b] hover:text-[#f59e0b]"
            >
              Load sample
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="px-3 pt-3 text-xs text-rose-400">{error}</p> : null}
      {status ? <p className="px-3 pt-3 text-xs text-[#d6c3a3]">{status}</p> : null}
    </div>
  );
}

function formatUpdated(updatedAt: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="px-3 pb-2 pt-4 text-[10px] uppercase tracking-widest text-[#8a7355]">{children}</h2>;
}

function SmallButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded border border-[#3d2a18] px-2 py-1 text-[11px] text-[#d6c3a3] hover:border-[#6b4a2b] hover:text-[#f59e0b]"
    >
      {children}
    </button>
  );
}
