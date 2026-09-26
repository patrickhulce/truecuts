import { type HistoryState } from "./history";
import { HISTORY_STORE, openTruecutsDb } from "./idb";

const RECORD = "document";

export async function loadHistory(): Promise<HistoryState | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openTruecutsDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, "readonly");
      const request = tx.objectStore(HISTORY_STORE).get(RECORD);
      request.onsuccess = () => {
        const value = request.result as HistoryState | undefined;
        resolve(isHistoryState(value) ? value : undefined);
      };
      request.onerror = () => reject(request.error ?? new Error("Failed to read history"));
      tx.oncomplete = () => db.close();
    });
  } catch {
    return undefined;
  }
}

export async function saveHistory(state: HistoryState): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openTruecutsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, "readwrite");
      tx.objectStore(HISTORY_STORE).put(state, RECORD);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error("Failed to write history"));
    });
  } catch {
    // History is best-effort; localStorage still holds the live document.
  }
}

function isHistoryState(value: unknown): value is HistoryState {
  if (!value || typeof value !== "object") return false;
  const record = value as HistoryState;
  return Array.isArray(record.entries) && typeof record.cursor === "number";
}

export function seedHistory(yaml: string): HistoryState {
  return { entries: [yaml], cursor: 0 };
}
