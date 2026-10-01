/**
 * Persistent caches for the web share, kept in one IndexedDB database.
 *
 * - `viewer-images`: every image asset's two LOD tiers (WebP 82/100) so opening
 *   the viewer — and zooming in — is a cache hit.
 * - `thumbnails`: the grid thumbnails, so revisiting (even after a machine or
 *   browser restart) does not re-download the whole grid over the tunnel.
 *
 * The bytes must survive a browser or machine restart, so they are stored in
 * IndexedDB — unlike the Cache API it works over both http (local tunnels) and
 * https (Cloudflare), and it is not wiped when DevTools "Disable cache" is on.
 * Each store is capped and evicts the least-recently-used entries over budget.
 */

export const PREFETCH_CACHE_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const THUMBNAIL_CACHE_MAX_BYTES = 256 * 1024 * 1024; // 256 MiB

const DB_NAME = 'serpent-web-share';
const DB_VERSION = 2;
const PREFETCH_STORE = 'viewer-images';
const THUMBNAIL_STORE = 'thumbnails';

export interface PrefetchCacheKey {
  libraryId: string;
  assetId: string;
  revisionId: string;
  tier: 'low' | 'high';
}

interface CacheRecord {
  key: string;
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
        for (const name of [PREFETCH_STORE, THUMBNAIL_STORE]) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
          }
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

/** One IndexedDB object store of `{ blob }` records with an LRU byte budget. */
class BlobStore {
  readonly #store: string;
  readonly #maxBytes: number;
  #db: Promise<IDBDatabase | null> | undefined;

  constructor(store: string, maxBytes: number) {
    this.#store = store;
    this.#maxBytes = maxBytes;
  }

  #database(): Promise<IDBDatabase | null> {
    this.#db ??= openDatabase();
    return this.#db;
  }

  async get(key: string): Promise<Blob | undefined> {
    const db = await this.#database();
    if (db === null) return undefined;
    try {
      const tx = db.transaction(this.#store, 'readonly');
      const record = await requestResult<CacheRecord>(
        tx.objectStore(this.#store).get(key) as IDBRequest<CacheRecord>,
      );
      return record?.blob;
    } catch {
      return undefined;
    }
  }

  async count(key: string): Promise<number> {
    const db = await this.#database();
    if (db === null) return 0;
    try {
      const tx = db.transaction(this.#store, 'readonly');
      return (await requestResult<number>(tx.objectStore(this.#store).count(key))) ?? 0;
    } catch {
      return 0;
    }
  }

  /** Store bytes, refreshing recency and evicting LRU entries over budget. */
  async put(key: string, blob: Blob): Promise<boolean> {
    const db = await this.#database();
    if (db === null) return false;
    try {
      const record: CacheRecord = { key, bytes: blob.size, savedAt: Date.now(), blob };
      const tx = db.transaction(this.#store, 'readwrite');
      tx.objectStore(this.#store).put(record);
      await txDone(tx);
      await this.#evict(db);
      return true;
    } catch {
      // Best effort; a full/blocked IndexedDB must not break the page.
      return false;
    }
  }

  async #evict(db: IDBDatabase): Promise<void> {
    const readTx = db.transaction(this.#store, 'readonly');
    const all = (await requestResult<CacheRecord[]>(
      readTx.objectStore(this.#store).getAll() as IDBRequest<CacheRecord[]>,
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
    const delTx = db.transaction(this.#store, 'readwrite');
    const delStore = delTx.objectStore(this.#store);
    for (const key of toDelete) delStore.delete(key);
    await txDone(delTx);
  }

  async totalBytes(): Promise<number> {
    const db = await this.#database();
    if (db === null) return 0;
    try {
      const tx = db.transaction(this.#store, 'readonly');
      const all = (await requestResult<CacheRecord[]>(
        tx.objectStore(this.#store).getAll() as IDBRequest<CacheRecord[]>,
      )) ?? [];
      return all.reduce((sum, record) => sum + record.bytes, 0);
    } catch {
      return 0;
    }
  }

  async clear(): Promise<void> {
    const db = await this.#database();
    if (db === null) return;
    try {
      const tx = db.transaction(this.#store, 'readwrite');
      tx.objectStore(this.#store).clear();
      await txDone(tx);
    } catch {
      // Ignore.
    }
  }
}

export class PrefetchCache {
  readonly #store: BlobStore;

  constructor(maxBytes: number = PREFETCH_CACHE_MAX_BYTES) {
    this.#store = new BlobStore(PREFETCH_STORE, maxBytes);
  }

  /** Cached bytes for one tier, or `undefined` on a miss. */
  get(input: PrefetchCacheKey): Promise<Blob | undefined> {
    return this.#store.get(recordKey(input));
  }

  async has(input: PrefetchCacheKey): Promise<boolean> {
    return (await this.#store.count(recordKey(input))) > 0;
  }

  put(input: PrefetchCacheKey, blob: Blob): Promise<boolean> {
    return this.#store.put(recordKey(input), blob);
  }

  /** Current total stored bytes (for tests / diagnostics). */
  totalBytes(): Promise<number> {
    return this.#store.totalBytes();
  }

  /** Drop everything (revision change / logout). */
  clear(): Promise<void> {
    return this.#store.clear();
  }
}

/** Long-lived grid-thumbnail cache, keyed by the (versioned) request URL. */
export class ThumbnailCache {
  readonly #store: BlobStore;

  constructor(maxBytes: number = THUMBNAIL_CACHE_MAX_BYTES) {
    this.#store = new BlobStore(THUMBNAIL_STORE, maxBytes);
  }

  get(url: string): Promise<Blob | undefined> {
    return this.#store.get(url);
  }

  put(url: string, blob: Blob): Promise<boolean> {
    return this.#store.put(url, blob);
  }

  /** Fetch a thumbnail once and remember its bytes for the next visit. */
  async remember(url: string): Promise<void> {
    try {
      const request = globalThis.fetch.bind(globalThis);
      const response = await request(url, { credentials: 'same-origin' });
      if (!response.ok) return;
      const blob = await response.blob();
      await this.#store.put(url, blob);
    } catch {
      // Best effort.
    }
  }

  totalBytes(): Promise<number> {
    return this.#store.totalBytes();
  }

  clear(): Promise<void> {
    return this.#store.clear();
  }
}

export const prefetchCache = new PrefetchCache();
export const thumbnailCache = new ThumbnailCache();
