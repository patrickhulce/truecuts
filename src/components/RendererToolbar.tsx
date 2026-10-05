"use client";

import { Blocks, House, Scaling, Unlink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type RendererToolbarProps = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  explode: number;
  onExplode: (value: number) => void;
  resize: boolean;
  onResize: (value: boolean) => void;
  measure: boolean;
  onMeasure: (value: boolean) => void;
  showContacts: boolean;
  onShowContacts: (value: boolean) => void;
  enabled: boolean;
};

type CameraToolbarProps = {
  showUnattached: boolean;
  onShowUnattached: (value: boolean) => void;
  pan: boolean;
  canFrame: boolean;
  onResetView: () => void;
  onPan: (value: boolean) => void;
};

const toolClass =
  "grid h-8 w-8 cursor-pointer place-items-center rounded text-[#d6c3a3] hover:bg-[#2a1d12] hover:text-[#f59e0b] disabled:cursor-not-allowed disabled:text-[#8a7355] disabled:hover:bg-transparent disabled:hover:text-[#8a7355]";

export function RendererToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  explode,
  onExplode,
  resize,
  onResize,
  measure,
  onMeasure,
  showContacts,
  onShowContacts,
  enabled,
}: RendererToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [explodeOpen, setExplodeOpen] = useState(false);

  useEffect(() => {
    if (!explodeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExplodeOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [explodeOpen]);

  return (
    <div
      ref={rootRef}
      className="absolute left-3 top-3 z-20 flex flex-col items-center gap-1 rounded-lg border border-[#3d2a18] bg-[#241a10]/95 p-1 shadow-xl"
    >
      <ToolButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        <UndoIcon />
      </ToolButton>
      <ToolButton label="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
        <RedoIcon />
      </ToolButton>
      <div className="my-0.5 h-px w-6 bg-[#3d2a18]" />
      <ToolButton label="Resize (R)" pressed={resize} disabled={!enabled} onClick={() => onResize(!resize)}>
        <Scaling className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </ToolButton>
      <ToolButton label="Measure (M)" pressed={measure} disabled={!enabled} onClick={() => onMeasure(!measure)}>
        <RulerIcon />
      </ToolButton>
      <div className="relative">
        <ToolButton
          label="Explode"
          pressed={explodeOpen || explode > 0}
          disabled={!enabled}
          onClick={() => setExplodeOpen((open) => !open)}
        >
          <Blocks className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        {explodeOpen ? (
          <div className="absolute left-full top-0 ml-2 w-56 rounded-md border border-[#3d2a18] bg-[#241a10]/95 p-3 text-xs text-[#d6c3a3] shadow-lg">
            <div className="flex items-center justify-between text-[#a89070]">
              <span>Explode</span>
              <span className="tabular-nums">{Math.round(explode * 100)}%</span>
            </div>
            <input
              aria-label="Explode amount"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explode}
              onChange={(event) => onExplode(Number(event.target.value))}
              className="mt-2 h-1 w-full cursor-pointer accent-[#f59e0b]"
            />
            <div className="mt-2 flex gap-1">
              <Preset label="0% (Assembled)" selected={explode === 0} onClick={() => onExplode(0)} />
              <Preset label="50%" selected={explode === 0.5} onClick={() => onExplode(0.5)} />
              <Preset label="100%" selected={explode === 1} onClick={() => onExplode(1)} />
            </div>
          </div>
        ) : null}
      </div>
      <ToolButton
        label="Contacts"
        pressed={showContacts}
        disabled={!enabled}
        onClick={() => onShowContacts(!showContacts)}
      >
        <ContactsIcon open={showContacts} />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`${toolClass} ${pressed ? "text-[#f59e0b]" : ""}`}
    >
      {children}
    </button>
  );
}

function Preset({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 cursor-pointer rounded border px-1.5 py-1 ${
        selected
          ? "border-[#f59e0b] text-[#f59e0b]"
          : "border-[#3d2a18] text-[#a89070] hover:border-[#6b4a2b] hover:text-[#d6c3a3]"
      }`}
    >
      {label}
    </button>
  );
}

export function CameraToolbar({
  showUnattached,
  onShowUnattached,
  pan,
  canFrame,
  onResetView,
  onPan,
}: CameraToolbarProps) {
  return (
    <div className="absolute bottom-7 right-44 z-20 flex items-center gap-1 rounded-lg border border-[#3d2a18] bg-[#241a10]/95 p-1 shadow-xl">
      <ToolButton
        label="Unattached"
        pressed={showUnattached}
        onClick={() => onShowUnattached(!showUnattached)}
      >
        <Unlink className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </ToolButton>
      <div className="mx-0.5 h-6 w-px bg-[#3d2a18]" />
      <ToolButton label="Pan (P)" pressed={pan} onClick={() => onPan(!pan)}>
        <PanIcon />
      </ToolButton>
      <ToolButton label="Reset view (Home)" disabled={!canFrame} onClick={onResetView}>
        <House className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </ToolButton>
    </div>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"
      />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"
      />
    </svg>
  );
}

function PanIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.5v19M2.5 12h19M12 2.5 8.5 6M12 2.5 15.5 6M12 21.5 8.5 18M12 21.5 15.5 18M2.5 12 6 8.5M2.5 12 6 15.5M21.5 12 18 8.5M21.5 12 18 15.5"
      />
    </svg>
  );
}

function RulerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M4 8.5h16v7H4z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M7 8.5v3.2M10 8.5v2M13 8.5v3.2M16 8.5v2M19 8.5v3.2"
      />
    </svg>
  );
}

function ContactsIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"
      />
      <circle cx="12" cy="12" r="2.2" fill={open ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
