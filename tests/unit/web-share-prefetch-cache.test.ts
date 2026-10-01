// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { PrefetchCache } from '../../src/myqy-web-share/client/prefetch-cache';

/**
 * IndexedDB is not guaranteed in the test DOM. When it is absent these tests
 * assert the graceful no-op path; when present they exercise the real store.
 * The scheduling that matters (order/pause/resume) is covered by the queue test
 * with an injected cache double.
 */
const hasIndexedDb = typeof indexedDB !== 'undefined';

describe('prefetch cache', () => {
  it('degrades to misses when IndexedDB is unavailable', async () => {
    if (hasIndexedDb) return;
    const cache = new PrefetchCache();
    const key = { libraryId: 'l', assetId: 'a', revisionId: 'r', tier: 'low' as const };
    expect(await cache.get(key)).toBeUndefined();
    expect(await cache.has(key)).toBe(false);
    await expect(cache.put(key, new Blob([new Uint8Array(4)]))).resolves.toBe(false);
  });

  it('stores and reads bytes back, and reports recency/has', async () => {
    if (!hasIndexedDb) return;
    const cache = new PrefetchCache(1024 * 1024);
    await cache.clear();
    const key = { libraryId: 'l', assetId: 'a', revisionId: 'r', tier: 'low' as const };
    await cache.put(key, new Blob([new Uint8Array(8)], { type: 'image/webp' }));
    expect(await cache.has(key)).toBe(true);
    expect((await cache.get(key))?.size).toBe(8);
    expect(await cache.totalBytes()).toBe(8);
  });

  it('evicts least-recently-used entries over budget', async () => {
    if (!hasIndexedDb) return;
    const cache = new PrefetchCache(1000);
    await cache.clear();
    const base = { libraryId: 'l', revisionId: 'r', tier: 'low' as const };
    await cache.put({ ...base, assetId: 'first' }, new Blob([new Uint8Array(800)]));
    await cache.put({ ...base, assetId: 'second' }, new Blob([new Uint8Array(800)]));
    // Budget is 1000: only the newest 800-byte entry should survive.
    expect(await cache.has({ ...base, assetId: 'first' })).toBe(false);
    expect(await cache.has({ ...base, assetId: 'second' })).toBe(true);
  });
});
