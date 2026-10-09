/** Tiny IndexedDB key/value wrapper: players, song blobs, analysis cache, scores. */
const DB_NAME = 'move-or-lose';
const STORES = ['players', 'songs', 'blobs', 'scores', 'kv'] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode) {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const db = {
  async get<T>(s: StoreName, key: string): Promise<T | undefined> {
    return wrap((await store(s, 'readonly')).get(key));
  },
  async put<T>(s: StoreName, key: string, value: T): Promise<void> {
    await wrap((await store(s, 'readwrite')).put(value, key));
  },
  async del(s: StoreName, key: string): Promise<void> {
    await wrap((await store(s, 'readwrite')).delete(key));
  },
  async all<T>(s: StoreName): Promise<T[]> {
    return wrap((await store(s, 'readonly')).getAll()) as Promise<T[]>;
  },
};
