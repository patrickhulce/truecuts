import { BUILDS_STORE, openTruecutsDb } from "./idb";
import { type BuildRecord } from "./builds";

function isBuildRecord(value: unknown): value is BuildRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BuildRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.yaml === "string" &&
    typeof record.updatedAt === "number" &&
    typeof record.memberCount === "number"
  );
}

export async function loadSavedBuilds(): Promise<BuildRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openTruecutsDb();
  const builds = await new Promise<BuildRecord[]>((resolve, reject) => {
    const tx = db.transaction(BUILDS_STORE, "readonly");
    const request = tx.objectStore(BUILDS_STORE).getAll();
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      resolve(rows.filter(isBuildRecord).sort((a, b) => b.updatedAt - a.updatedAt));
    };
    request.onerror = () => reject(request.error ?? new Error("Failed to read builds"));
    tx.oncomplete = () => db.close();
  });
  return builds;
}

export async function saveBuild(build: BuildRecord): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
  const db = await openTruecutsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BUILDS_STORE, "readwrite");
    tx.objectStore(BUILDS_STORE).put(build, build.id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save build"));
  });
}

export async function deleteBuild(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openTruecutsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BUILDS_STORE, "readwrite");
    tx.objectStore(BUILDS_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete build"));
  });
}

export async function replaceAllBuilds(builds: BuildRecord[]): Promise<void> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
  const db = await openTruecutsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BUILDS_STORE, "readwrite");
    const store = tx.objectStore(BUILDS_STORE);
    store.clear();
    for (const build of builds) store.put(build, build.id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("Failed to replace builds"));
  });
}

export async function clearBuilds(): Promise<void> {
  await replaceAllBuilds([]);
}
