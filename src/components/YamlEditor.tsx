"use client";

import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import type { Diagnostic } from "@/lib/compile";

function indexFromLineCol(text: string, line = 1, column = 1): number {
  let index = 0;
  let current = 1;
  while (current < line && index < text.length) {
    const next = text.indexOf("\n", index);
    if (next === -1) return text.length;
    index = next + 1;
    current += 1;
  }
  return Math.min(text.length, index + Math.max(0, column - 1));
}

const woodTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#1a120b",
      color: "#d6c3a3",
      height: "100%",
      fontSize: "13px",
    },
    ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-ibm-plex-mono), ui-monospace, monospace" },
    ".cm-content": { caretColor: "#f59e0b" },
    ".cm-gutters": {
      backgroundColor: "#140e09",
      color: "#8a7355",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "#2a1d1288" },
    ".cm-activeLineGutter": { backgroundColor: "#2a1d12" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "#d9770666",
    },
    ".cm-cursor": { borderLeftColor: "#f59e0b" },
    ".cm-tooltip": {
      backgroundColor: "#241a10",
      color: "#d6c3a3",
      border: "1px solid #3d2a18",
    },
    ".cm-diagnostic": { fontSize: "12px" },
  },
  { dark: true },
);

const woodHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#7c6a53", fontStyle: "italic" },
  { tag: t.keyword, color: "#f59e0b" },
  { tag: t.atom, color: "#fbbf24" },
  { tag: t.number, color: "#fdba74" },
  { tag: t.string, color: "#e8c07a" },
  { tag: t.propertyName, color: "#d6c3a3" },
  { tag: t.separator, color: "#a89070" },
  { tag: t.bool, color: "#fbbf24" },
]);

type YamlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  diagnostics: Diagnostic[];
};

export function YamlEditor({ value, onChange, diagnostics }: YamlEditorProps) {
  const extensions = useMemo(() => {
    const lintExt = linter(() => {
      return diagnostics.map((diagnostic): CmDiagnostic => {
        const from = indexFromLineCol(value, diagnostic.line ?? 1, diagnostic.column ?? 1);
        const to = Math.min(value.length, Math.max(from + 1, from));
        return {
          from,
          to,
          severity: diagnostic.severity,
          message: diagnostic.message,
        };
      });
    });
    const blockHistory = Prec.highest(
      keymap.of([
        { key: "Mod-z", run: () => true },
        { key: "Mod-Shift-z", run: () => true },
        { key: "Mod-y", run: () => true },
      ]),
    );
    return [yaml(), woodTheme, syntaxHighlighting(woodHighlight), lintGutter(), lintExt, blockHistory];
  }, [diagnostics, value]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="none"
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        autocompletion: false,
      }}
      className="h-full overflow-hidden"
    />
  );
}
