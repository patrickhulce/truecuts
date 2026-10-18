"use client";

import { useState } from "react";
import { formatInches, parseDimension } from "@/lib/units";

/** Keep incomplete expressions editable; commit a valid dimension on blur or Enter. */
export function DimensionField({
  value, onCommit, min, max, exclusive = false, className, label,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  exclusive?: boolean;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(formatInches(value));
  const [committed, setCommitted] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (committed !== value) {
    setCommitted(value);
    setDraft(formatInches(value));
    setError(null);
  }
  function commit() {
    try {
      const next = parseDimension(draft);
      if (min !== undefined && (exclusive ? next <= min : next < min)) {
        throw new Error(`Must be ${exclusive ? "greater than" : "at least"} ${formatInches(min)}`);
      }
      if (max !== undefined && next > max) throw new Error(`Must be at most ${formatInches(max)}`);
      setDraft(formatInches(next));
      setError(null);
      if (next !== value) onCommit(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid dimension");
    }
  }
  return (
    <span className="min-w-0 flex-1">
      <input
        type="text"
        aria-label={label}
        aria-invalid={error !== null}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setError(null); }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { setDraft(formatInches(value)); setError(null); }
        }}
        className={className}
      />
      {error ? <span role="alert" className="mt-1 block text-xs normal-case tracking-normal text-rose-400">{error}</span> : null}
    </span>
  );
}
