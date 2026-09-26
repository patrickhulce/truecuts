export const TRUECUTS_DB = "truecuts";
export const TRUECUTS_DB_VERSION = 2;
export const HISTORY_STORE = "history";
export const BUILDS_STORE = "builds";

export function openTruecutsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRUECUTS_DB, TRUECUTS_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) db.createObjectStore(HISTORY_STORE);
      if (!db.objectStoreNames.contains(BUILDS_STORE)) db.createObjectStore(BUILDS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}
