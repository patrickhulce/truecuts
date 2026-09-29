"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RenderAlertTone = "error" | "warning" | "info";

export type RenderAlert = {
  id: string;
  tone: RenderAlertTone;
  message: string;
};

const TINT: Record<RenderAlertTone, string> = {
  error: "bg-red-600/20 ring-4 ring-inset ring-red-500/50 backdrop-brightness-95",
  warning: "bg-amber-500/20 ring-4 ring-inset ring-amber-400/40 backdrop-brightness-95",
  info: "bg-sky-500/15 ring-4 ring-inset ring-sky-400/35 backdrop-brightness-95",
};

const BADGE: Record<RenderAlertTone, string> = {
  error: "border-red-400/80 bg-[#3f1212]/95 text-red-100",
  warning: "border-amber-400/80 bg-[#3f2a10]/95 text-amber-100",
  info: "border-sky-400/80 bg-[#102433]/95 text-sky-100",
};

/**
 * One viewport notice at a time. The overlay is not focusable and ignores
 * pointer events, so shortcuts and the canvas keep whatever focus they had.
 */
export function useRenderAlert() {
  const [alert, setAlert] = useState<RenderAlert | null>(null);
  const timer = useRef<number | null>(null);
  const serial = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setAlert(null);
  }, []);

  const show = useCallback((tone: RenderAlertTone, message: string, duration = 2800) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    serial.current += 1;
    setAlert({ id: `render-alert-${serial.current}`, tone, message });
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setAlert(null);
    }, duration);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return { alert, show, dismiss };
}

export function RenderAlertOverlay({ alert }: { alert: RenderAlert | null }) {
  if (!alert) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30" role="status" aria-live="polite" aria-atomic="true">
      <div className={`absolute inset-0 ${TINT[alert.tone]}`} />
      <div
        className={`absolute left-1/2 top-4 flex max-w-sm -translate-x-1/2 items-center gap-2 rounded-md border px-3 py-1.5 text-xs shadow-lg ${BADGE[alert.tone]}`}
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {alert.tone === "error" ? "●" : alert.tone === "warning" ? "▲" : "i"}
        </span>
        <span>{alert.message}</span>
      </div>
    </div>
  );
}
