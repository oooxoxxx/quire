import type { StoredAttachment, StoredEntry } from "./types.ts";

const DB_NAME = "quire";
const DB_VERSION = 1;

let databasePromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("NO_INDEXEDDB"));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("entries")) {
          const entries = db.createObjectStore("entries", { keyPath: "id" });
          entries.createIndex("entryDate", "entryDate");
          entries.createIndex("appleSourceId", "appleSourceId");
        }
        if (!db.objectStoreNames.contains("attachments")) {
          db.createObjectStore("attachments", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("conflicts")) {
          db.createObjectStore("conflicts", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = null;
        reject(request.error ?? new Error("INDEXEDDB"));
      };
    });
  }
  return databasePromise;
}

async function withStore<T>(
  name: "entries" | "attachments" | "meta" | "conflicts",
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(name, mode);
  const store = tx.objectStore(name);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("TX"));
    tx.onabort = () => reject(tx.error ?? new Error("TX_ABORT"));
  });
  try {
    const result = fn(store);
    const value = result instanceof IDBRequest ? await requestToPromise(result) : await result;
    await done;
    return value;
  } catch (error) {
    try {
      await done;
    } catch {
      /* The transaction failure is reported by the original error. */
    }
    throw error;
  }
}

export const journalDb = {
  async getMeta<T>(key: string): Promise<T | null> {
    const value = await withStore("meta", "readonly", (store) => store.get(key));
    return (value as T | undefined) ?? null;
  },
  async setMeta(key: string, value: unknown): Promise<void> {
    await withStore("meta", "readwrite", (store) => store.put(value, key));
  },
  async allEntries(): Promise<StoredEntry[]> {
    const rows = await withStore("entries", "readonly", (store) => store.getAll());
    return (rows as StoredEntry[]) ?? [];
  },
  async putEntry(entry: StoredEntry): Promise<void> {
    await withStore("entries", "readwrite", (store) => store.put(entry));
  },
  async deleteEntry(id: string): Promise<void> {
    await withStore("entries", "readwrite", (store) => store.delete(id));
  },
  async allAttachments(): Promise<StoredAttachment[]> {
    const rows = await withStore("attachments", "readonly", (store) => store.getAll());
    return (rows as StoredAttachment[]) ?? [];
  },
  async getAttachment(id: string): Promise<StoredAttachment | null> {
    const row = await withStore("attachments", "readonly", (store) => store.get(id));
    return (row as StoredAttachment | undefined) ?? null;
  },
  async putAttachment(attachment: StoredAttachment): Promise<void> {
    await withStore("attachments", "readwrite", (store) => store.put(attachment));
  },
  async deleteAttachment(id: string): Promise<void> {
    await withStore("attachments", "readwrite", (store) => store.delete(id));
  },
  async allConflicts<T>(): Promise<T[]> {
    const rows = await withStore("conflicts", "readonly", (store) => store.getAll());
    return (rows as T[]) ?? [];
  },
  async putConflict(conflict: { id: string }): Promise<void> {
    await withStore("conflicts", "readwrite", (store) => store.put(conflict));
  },
  async deleteConflict(id: string): Promise<void> {
    await withStore("conflicts", "readwrite", (store) => store.delete(id));
  },
};
