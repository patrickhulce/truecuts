import { type HistoryState } from "./history";

const DB_NAME = "truecuts";
const STORE = "history";
const RECORD = "document";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

export async function loadHistory(): Promise<HistoryState | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(RECORD);
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
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, RECORD);
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
