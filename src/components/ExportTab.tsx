"use client";

import { useState } from "react";
import {
  EXPORT_ELEVATION_MAX,
  EXPORT_ELEVATION_MIN,
  EXPORT_FOV_MAX,
  EXPORT_FOV_MIN,
  clampElevation,
  clampFov,
  defaultExportCameras,
  nextExportCamera,
  normalizeAzimuth,
  type ExportCamera,
} from "@/lib/export-view";

type ExportTabProps = {
  cameras: ExportCamera[];
  title: string;
  dimensions: string;
  canExport: boolean;
  exporting: boolean;
  error: string | null;
  onCameras: (cameras: ExportCamera[]) => void;
  onUseCurrent: (id: string) => void;
  onPreview: (camera: ExportCamera) => void;
  onDownload: () => void;
};

const fieldClass = "w-full rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm text-[#d6c3a3]";
const minorButtonClass =
  "cursor-pointer rounded border border-[#3d2a18] px-2 py-1 text-[11px] text-[#d6c3a3] hover:border-[#f59e0b] hover:text-[#f59e0b] disabled:cursor-not-allowed disabled:text-[#8a7355] disabled:hover:border-[#3d2a18] disabled:hover:text-[#8a7355]";

export function ExportTab({
  cameras,
  title,
  dimensions,
  canExport,
  exporting,
  error,
  onCameras,
  onUseCurrent,
  onPreview,
  onDownload,
}: ExportTabProps) {
  function replace(id: string, next: ExportCamera) {
    onCameras(cameras.map((camera) => (camera.id === id ? next : camera)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= cameras.length) return;
    const copy = cameras.slice();
    const [item] = copy.splice(index, 1);
    if (!item) return;
    copy.splice(target, 0, item);
    onCameras(copy);
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onDownload}
          disabled={!canExport || exporting}
          className="w-full cursor-pointer rounded border border-[#f59e0b] bg-[#f59e0b] px-3 py-2 text-sm font-medium text-[#1a120b] hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:border-[#3d2a18] disabled:bg-[#241a10] disabled:text-[#8a7355]"
        >
          {exporting ? "Rendering sheet…" : "Download PNG"}
        </button>
        <h2 className="mt-3 font-[family-name:var(--font-display)] text-lg text-[#f59e0b]">{title}</h2>
        <p className="mt-1 text-xs text-[#d6c3a3]">{dimensions}</p>
        <p className="mt-1 text-[11px] text-[#8a7355]">Overall size is length × width × height.</p>
      </div>

      <SectionTitle>Cameras</SectionTitle>
      {cameras.length === 0 ? (
        <p className="px-3 text-xs text-[#8a7355]">No cameras on the sheet. Add one or reset to the defaults.</p>
      ) : (
        <div className="mx-3 flex flex-col gap-2">
          {cameras.map((camera, index) => (
            <CameraCard
              key={camera.id}
              camera={camera}
              index={index}
              count={cameras.length}
              viewReady={canExport && !exporting}
              onChange={(next) => replace(camera.id, next)}
              onMove={(direction) => move(index, direction)}
              onDelete={() => onCameras(cameras.filter((item) => item.id !== camera.id))}
              onUseCurrent={() => onUseCurrent(camera.id)}
              onPreview={() => onPreview(camera)}
            />
          ))}
        </div>
      )}

      <div className="mx-3 mt-3 flex gap-2">
        <button type="button" onClick={() => onCameras([...cameras, nextExportCamera(cameras)])} className={minorButtonClass}>
          Add camera
        </button>
        <button type="button" onClick={() => onCameras(defaultExportCameras())} className={minorButtonClass}>
          Reset defaults
        </button>
      </div>
      {error ? <p className="px-3 pt-3 text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

function CameraCard({
  camera,
  index,
  count,
  viewReady,
  onChange,
  onMove,
  onDelete,
  onUseCurrent,
  onPreview,
}: {
  camera: ExportCamera;
  index: number;
  count: number;
  viewReady: boolean;
  onChange: (camera: ExportCamera) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onUseCurrent: () => void;
  onPreview: () => void;
}) {
  const fitted = camera.fov === null;

  return (
    <section className="rounded border border-[#3d2a18] p-2.5">
      <div className="flex items-start gap-1">
        <NameField value={camera.name} onCommit={(name) => onChange({ ...camera, name })} />
        <button
          type="button"
          aria-label={`Move ${camera.name} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className={`${minorButtonClass} px-1.5`}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${camera.name} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          className={`${minorButtonClass} px-1.5`}
        >
          ↓
        </button>
        <button type="button" aria-label={`Remove ${camera.name}`} onClick={onDelete} className={`${minorButtonClass} px-1.5`}>
          ×
        </button>
      </div>
      <AngleField
        label={`${camera.name} azimuth`}
        min={0}
        max={360}
        value={camera.azimuthDeg}
        normalize={normalizeAzimuth}
        onChange={(azimuthDeg) => onChange({ ...camera, azimuthDeg })}
      />
      <AngleField
        label={`${camera.name} elevation`}
        min={EXPORT_ELEVATION_MIN}
        max={EXPORT_ELEVATION_MAX}
        value={camera.elevationDeg}
        normalize={clampElevation}
        onChange={(elevationDeg) => onChange({ ...camera, elevationDeg })}
      />
      <div className="mt-2">
        <div className="flex items-center justify-between text-[11px] text-[#a89070]">
          <span>Field of view</span>
          {camera.pinned ? <span className="text-[#d6c3a3]">Pinned view</span> : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={fitted}
            onClick={() => onChange({ ...camera, fov: null, pinned: null })}
            className={`cursor-pointer rounded border px-2 py-1 text-[11px] ${
              fitted ? "border-[#f59e0b] text-[#f59e0b]" : "border-[#3d2a18] text-[#a89070] hover:text-[#d6c3a3]"
            }`}
          >
            Fit
          </button>
          <FovField
            value={camera.fov}
            onCommit={(fov) => onChange({ ...camera, fov, pinned: null })}
          />
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button type="button" disabled={!viewReady} onClick={onUseCurrent} className={minorButtonClass}>
          Use current
        </button>
        <button type="button" disabled={!viewReady} onClick={onPreview} className={minorButtonClass}>
          Preview
        </button>
      </div>
    </section>
  );
}

function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(value);
  if (committed !== value) {
    setCommitted(value);
    setDraft(value);
  }
  return (
    <input
      aria-label="Camera name"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim().slice(0, 80);
        if (!next) {
          setDraft(value);
          return;
        }
        setDraft(next);
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={`${fieldClass} min-w-0 flex-1`}
    />
  );
}

function FovField({ value, onCommit }: { value: number | null; onCommit: (fov: number) => void }) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [committed, setCommitted] = useState(value);
  if (committed !== value) {
    setCommitted(value);
    setDraft(value === null ? "" : String(value));
  }
  return (
    <input
      aria-label="Field of view"
      type="number"
      inputMode="decimal"
      min={EXPORT_FOV_MIN}
      max={EXPORT_FOV_MAX}
      step={1}
      placeholder="Fit"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        const trimmed = event.currentTarget.value.trim();
        if (!trimmed) {
          setDraft(value === null ? "" : String(value));
          return;
        }
        const next = Number(trimmed);
        if (!Number.isFinite(next)) {
          setDraft(value === null ? "" : String(value));
          return;
        }
        const fov = clampFov(next);
        setDraft(String(fov));
        if (fov !== value) onCommit(fov);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-16 rounded border border-[#3d2a18] bg-[#1a120b] px-2 py-1 text-sm text-[#d6c3a3]"
    />
  );
}

function formatAngle(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function AngleField({
  label,
  min,
  max,
  value,
  normalize,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  normalize: (value: number) => number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(formatAngle(value));
  const [committed, setCommitted] = useState(value);
  if (committed !== value) {
    setCommitted(value);
    setDraft(formatAngle(value));
  }
  const caption = label.replace(/.* (azimuth|elevation)$/, "$1");
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const next = Number(trimmed);
    if (!trimmed || !Number.isFinite(next)) {
      setDraft(formatAngle(value));
      return;
    }
    const angle = normalize(next);
    setDraft(formatAngle(angle));
    if (angle !== value) onChange(angle);
  };
  return (
    <div className="mt-2 text-[11px] text-[#a89070]">
      <div className="flex items-center justify-between gap-2">
        <span className="capitalize">{caption}</span>
        <span className="flex items-center gap-1 text-[#d6c3a3]">
          <input
            aria-label={label}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="w-16 rounded border border-[#3d2a18] bg-[#1a120b] px-1.5 py-0.5 text-right text-sm tabular-nums text-[#d6c3a3]"
          />
          °
        </span>
      </div>
      <input
        aria-label={`${label} slider`}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(normalize(Number(event.target.value)))}
        className="mt-1 h-1 w-full cursor-pointer accent-[#f59e0b]"
      />
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="px-3 pb-2 pt-4 text-[10px] uppercase tracking-widest text-[#8a7355]">{children}</h2>;
}
