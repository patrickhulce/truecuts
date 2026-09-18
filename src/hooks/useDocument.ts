"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { compileDocument } from "@/lib/compile";
import { DEMO_YAML } from "@/lib/demo";

const STORAGE_KEY = "truecuts.document.yaml";
const YAML_EVENT = "truecuts-yaml";

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
  return window.localStorage.getItem(STORAGE_KEY) ?? DEMO_YAML;
}

function persist(value: string) {
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new Event(YAML_EVENT));
}

export function useDocument() {
  const persisted = useSyncExternalStore(subscribe, getSnapshot, () => DEMO_YAML);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? persisted;
  const compiled = useMemo(() => compileDocument(text), [text]);

  useEffect(() => {
    const handle = window.setTimeout(() => persist(text), 300);
    return () => window.clearTimeout(handle);
  }, [text]);

  const reset = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(YAML_EVENT));
    setDraft(null);
  }, []);

  return { text, setText: (value: string) => setDraft(value), compiled, reset };
}
