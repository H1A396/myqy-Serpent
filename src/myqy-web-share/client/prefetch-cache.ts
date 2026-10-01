/**
 * Persistent viewer-image cache for the web share.
 *
 * The visitor's browser downloads every asset's two LOD tiers (WebP 82 and 100)
 * in the background so opening the viewer is instant. The bytes must survive a
 * browser or machine restart, so they are stored in IndexedDB — unlike the Cache
 * API it works over both http (local FRP-like tunnels) and https (Cloudflare).
 *
 * The total size is capped (`PREFETCH_CACHE_MAX_BYTES`); when a new entry would
 * exceed it, the least-recently-used entries are evicted. An entry's identity is
 * `libraryId + assetId + revisionId + tier`; a new revision simply misses.
 */

export const PREFETCH_CACHE_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB total

const DB_NAME = 'serpent-web-share';
const DB_VERSION = 1;
const STORE = 'viewer-images';

export interface PrefetchCacheKey {
  libraryId: string;
  assetId: string;
  revisionId: string;
  tier: 'low' | 'high';
}

interface CacheRecord {
  key: string;
  libraryId: string;
  assetId: string;
  revisionId: string;
  tier: 'low' | 'high';
  bytes: number;
  savedAt: number;
  blob: Blob;
}

function recordKey(input: PrefetchCacheKey): string {
  return `${input.libraryId}\u0001${input.assetId}\u0001${input.revisionId}\u0001${input.tier}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('savedAt', 'savedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

export class PrefetchCache {
  readonly #maxBytes: number;
  #db: Promise<IDBDatabase | null> | undefined;

  constructor(maxBytes: number = PREFETCH_CACHE_MAX_BYTES) {
    this.#maxBytes = maxBytes;
  }

  #database(): Promise<IDBDatabase | null> {
    this.#db ??= openDatabase();
    return this.#db;
  }

  /** Cached bytes for one tier, or `undefined` on a miss. */
  async get(input: PrefetchCacheKey): Promise<Blob | undefined> {
    const db = await this.#database();
    if (db === null) return undefined;
    try {
      const tx = db.transaction(STORE, 'readonly');
      const record = await requestResult<CacheRecord>(
        tx.objectStore(STORE).get(recordKey(input)) as IDBRequest<CacheRecord>,
      );
      return record?.blob;
    } catch {
      return undefined;
    }
  }

  async has(input: PrefetchCacheKey): Promise<boolean> {
    const db = await this.#database();
    if (db === null) return false;
    try {
      const tx = db.transaction(STORE, 'readonly');
      const count = await requestResult<number>(
        tx.objectStore(STORE).count(recordKey(input)),
      );
      return (count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** Store bytes, refreshing recency and evicting LRU entries over budget. */
  async put(input: PrefetchCacheKey, blob: Blob): Promise<void> {
    const db = await this.#database();
    if (db === null) return;
    try {
      const record: CacheRecord = {
        key: recordKey(input),
        libraryId: input.libraryId,
        assetId: input.assetId,
        revisionId: input.revisionId,
        tier: input.tier,
        bytes: blob.size,
        savedAt: Date.now(),
        blob,
      };
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      await txDone(tx);
      await this.#evict(db);
    } catch {
      // Best effort; a full/blocked IndexedDB must not break the viewer.
    }
  }

  async #evict(db: IDBDatabase): Promise<void> {
    const readTx = db.transaction(STORE, 'readonly');
    const store = readTx.objectStore(STORE);
    const all = (await requestResult<CacheRecord[]>(
      store.getAll() as IDBRequest<CacheRecord[]>,
    )) ?? [];
    let total = all.reduce((sum, record) => sum + record.bytes, 0);
    if (total <= this.#maxBytes) return;
    const oldest = [...all].sort((a, b) => a.savedAt - b.savedAt);
    const toDelete: string[] = [];
    for (const record of oldest) {
      if (total <= this.#maxBytes) break;
      toDelete.push(record.key);
      total -= record.bytes;
    }
    if (toDelete.length === 0) return;
    const delTx = db.transaction(STORE, 'readwrite');
    const delStore = delTx.objectStore(STORE);
    for (const key of toDelete) delStore.delete(key);
    await txDone(delTx);
  }

  /** Current total stored bytes (for tests / diagnostics). */
  async totalBytes(): Promise<number> {
    const db = await this.#database();
    if (db === null) return 0;
    const tx = db.transaction(STORE, 'readonly');
    const all = (await requestResult<CacheRecord[]>(
      tx.objectStore(STORE).getAll() as IDBRequest<CacheRecord[]>,
    )) ?? [];
    return all.reduce((sum, record) => sum + record.bytes, 0);
  }

  /** Drop everything (revision change / logout). */
  async clear(): Promise<void> {
    const db = await this.#database();
    if (db === null) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await txDone(tx);
    } catch {
      // Ignore.
    }
  }
}

export const prefetchCache = new PrefetchCache();
