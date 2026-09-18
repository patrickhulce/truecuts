"use client";

import type { Diagnostic } from "@/lib/compile";

type DiagnosticsPanelProps = {
  diagnostics: Diagnostic[];
};

export function DiagnosticsPanel({ diagnostics }: DiagnosticsPanelProps) {
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");

  if (diagnostics.length === 0) {
    return (
      <div className="border-t border-[#3d2a18] bg-[#140e09] px-3 py-2 text-xs text-[#8a7355]">
        YAML is square. Scene is up to date.
      </div>
    );
  }

  return (
    <div className="max-h-36 overflow-auto border-t border-[#3d2a18] bg-[#140e09] px-3 py-2 text-xs">
      <div className="mb-1 text-[#a89070]">
        {errors.length} error{errors.length === 1 ? "" : "s"}
        {warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}
      </div>
      <ul className="space-y-1">
        {diagnostics.map((item, index) => (
          <li
            key={`${item.line}-${index}-${item.message}`}
            className={item.severity === "error" ? "text-rose-400" : "text-amber-400"}
          >
            {item.line !== undefined ? (
              <span className="mr-2 text-[#8a7355]">L{item.line}</span>
            ) : null}
            {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
