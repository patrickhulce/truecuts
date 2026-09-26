"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { compileDocument } from "@/lib/compile";
import { DEMO_YAML } from "@/lib/demo";
import { migrateDocumentYaml } from "@/lib/migrate";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  currentYaml,
  emptyHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from "@/lib/history";
import { loadHistory, saveHistory, seedHistory } from "@/lib/history-idb";

const STORAGE_KEY = "truecuts.document.yaml";
const YAML_EVENT = "truecuts-yaml";
const HISTORY_DEBOUNCE_MS = 300;

function subscribe(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(YAML_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(YAML_EVENT, handler);
  };
}

function getSnapshot() {
  return migrateDocumentYaml(window.localStorage.getItem(STORAGE_KEY) ?? DEMO_YAML);
}

function persist(value: string) {
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new Event(YAML_EVENT));
}

export function useDocument() {
  const persisted = useSyncExternalStore(subscribe, getSnapshot, () => DEMO_YAML);
  const [draft, setDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>(emptyHistory);
  const [hydrated, setHydrated] = useState(false);
  const historyRef = useRef(history);
  const skipYamlRef = useRef<string | null>(null);
  const text = draft ?? persisted;
  const compiled = useMemo(() => compileDocument(text), [text]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    void loadHistory().then((stored) => {
      if (cancelled) return;
      const current = migrateDocumentYaml(window.localStorage.getItem(STORAGE_KEY) ?? DEMO_YAML);
      let next = stored && stored.entries.length > 0 ? stored : seedHistory(current);
      if (currentYaml(next) !== current) {
        next = pushHistory(next, current);
      }
      historyRef.current = next;
      setHistory(next);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const handle = window.setTimeout(() => {
      persist(text);
      if (skipYamlRef.current === text) {
        skipYamlRef.current = null;
        return;
      }
      const next = pushHistory(historyRef.current, text);
      if (next !== historyRef.current) {
        historyRef.current = next;
        setHistory(next);
        void saveHistory(next);
      }
    }, HISTORY_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [hydrated, text]);

  const commit = useCallback((value: string) => {
    const prev = historyRef.current;
    const next = pushHistory(prev.entries.length > 0 ? prev : seedHistory(value), value);
    skipYamlRef.current = value;
    historyRef.current = next;
    setHistory(next);
    setDraft(value);
    if (next !== prev) void saveHistory(next);
  }, []);

  const undo = useCallback(() => {
    const next = undoHistory(historyRef.current);
    if (!next) return;
    const yaml = currentYaml(next);
    if (yaml === undefined) return;
    skipYamlRef.current = yaml;
    historyRef.current = next;
    setHistory(next);
    setDraft(yaml);
    void saveHistory(next);
  }, []);

  const redo = useCallback(() => {
    const next = redoHistory(historyRef.current);
    if (!next) return;
    const yaml = currentYaml(next);
    if (yaml === undefined) return;
    skipYamlRef.current = yaml;
    historyRef.current = next;
    setHistory(next);
    setDraft(yaml);
    void saveHistory(next);
  }, []);

  const replaceDocument = useCallback((value: string) => {
    const next = seedHistory(value);
    skipYamlRef.current = value;
    historyRef.current = next;
    setHistory(next);
    setDraft(value);
    void saveHistory(next);
  }, []);

  const reset = useCallback(() => {
    replaceDocument(DEMO_YAML);
  }, [replaceDocument]);

  return {
    text,
    setText: (value: string) => setDraft(value),
    commit,
    compiled,
    reset,
    replaceDocument,
    undo,
    redo,
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
  };
}
