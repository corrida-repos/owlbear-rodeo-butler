/**
 * The collection's browser storage (IndexedDB, one database per extension origin, D3). Every extension page shares it;
 * a BroadcastChannel tells the other pages (popover, card, background) when it changes.
 */
import type { CollectionEntry } from "../core/collection";

const DB = "encounter-butler";
const STORE = "collection";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("butler-collection") : null;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("This browser blocked local storage, so the collection can't be saved here."));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(r ? (r.result as T) : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function listCollection(): Promise<CollectionEntry[]> {
  return ((await tx<CollectionEntry[]>("readonly", (s) => s.getAll())) ?? []);
}

export async function putEntries(entries: CollectionEntry[]) {
  await tx("readwrite", (s) => { for (const e of entries) s.put(e); });
  channel?.postMessage("changed");
}

export async function deleteEntry(id: string) {
  await tx("readwrite", (s) => { s.delete(id); });
  channel?.postMessage("changed");
}

/** Calls `fn` when another page changed the collection. */
export function onCollectionChange(fn: () => void) {
  channel?.addEventListener("message", () => fn());
}
