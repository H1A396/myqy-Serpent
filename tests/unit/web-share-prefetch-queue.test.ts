import { describe, expect, it, vi } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';
import type { PrefetchCache, PrefetchCacheKey } from '../../src/myqy-web-share/client/prefetch-cache';
import { PrefetchQueue } from '../../src/myqy-web-share/client/prefetch-queue';
import type { PrefetchProgress } from '../../src/myqy-web-share/client/prefetch-queue';
vi.mock('../../src/myqy-web-share/client/api', () => ({
  viewUrl: (_libraryId: string, asset: { assetId: string }, options?: { tier?: string }) =>
    options?.tier === 'high' ? `/view/${asset.assetId}?tier=high` : `/view/${asset.assetId}`,
}));

function makeAsset(assetId: string, mediaType: AssetSummary['mediaType'] = 'image'): AssetSummary {
  return {
    assetId,
    locationKind: 'managed',
    managedFolderId: null,
    relativeFilePath: `${assetId}.png`,
    displayName: `${assetId}.png`,
    currentRevisionId: `rev-${assetId}`,
    byteSize: 1024,
    modifiedAt: '2026-09-22T00:00:00.000Z',
    availability: 'available',
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: 'ready',
    thumbnailArtifactId: null,
    mediaType,
    width: 100,
    height: 100,
    durationMs: null,
  } as AssetSummary;
}

/** In-memory cache double recording what was stored. */
class FakeCache {
  readonly stored = new Map<string, number>();
  privateKey(input: PrefetchCacheKey): string {
    return `${input.assetId}:${input.tier}`;
  }
  async has(input: PrefetchCacheKey): Promise<boolean> {
    return this.stored.has(this.privateKey(input));
  }
  async put(input: PrefetchCacheKey, blob: Blob): Promise<boolean> {
    this.stored.set(this.privateKey(input), blob.size);
    return true;
  }
}

function flush(times = 6): Promise<void> {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      n += 1;
      if (n >= times) resolve();
      else setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  });
}

describe('prefetch queue', () => {
  it('downloads the whole low tier before the high tier', async () => {
    const cache = new FakeCache();
    const order: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      order.push(String(url));
      return { ok: true, blob: async () => new Blob([new Uint8Array(10)]) };
    }) as unknown as typeof fetch;
    const queue = new PrefetchQueue({ cache: cache as unknown as PrefetchCache, fetchImpl });

    queue.start('lib', [makeAsset('a'), makeAsset('b')]);
    await flush(10);
    queue.stop();

    expect(order).toEqual([
      '/view/a',
      '/view/b',
      '/view/a?tier=high',
      '/view/b?tier=high',
    ]);
  });

  it('skips tiers already in the cache and skips non-images', async () => {
    const cache = new FakeCache();
    cache.stored.set('a:low', 10);
    const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; blob: () => Promise<Blob> }>>(
      async () => ({
        ok: true,
        blob: async () => new Blob([new Uint8Array(10)]),
      }),
    );
    const queue = new PrefetchQueue({
      cache: cache as unknown as PrefetchCache,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    queue.start('lib', [makeAsset('a'), makeAsset('v', 'video')]);
    await flush(10);
    queue.stop();

    // 'a' low is cached 鈫?only its high downloads; the video is never fetched.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(['/view/a?tier=high']);
  });

  it('pauses while the viewer is open and resumes after close', async () => {
    const cache = new FakeCache();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array(10)]),
    }));
    const queue = new PrefetchQueue({
      cache: cache as unknown as PrefetchCache,
      fetchImpl: fetchMock as unknown as typeof fetch,
      gapMs: 0,
    });

    queue.pause();
    queue.start('lib', [makeAsset('a'), makeAsset('b')]);
    await flush(6);
    // Paused before anything could start.
    expect(fetchMock).not.toHaveBeenCalled();

    queue.resume();
    await flush(12);
    queue.stop();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('reports per-tier progress for the on-screen indicator', async () => {
    const cache = new FakeCache();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array(10)]),
    }));
    const queue = new PrefetchQueue({
      cache: cache as unknown as PrefetchCache,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const seen: PrefetchProgress[] = [];
    queue.subscribe((progress) => seen.push({ ...progress }));

    // The video is excluded from the totals (only images are prefetched).
    queue.start('lib', [makeAsset('a'), makeAsset('b'), makeAsset('v', 'video')]);
    await flush(16);

    const started = seen.find((progress) => progress.active && progress.tier === 'low');
    expect(started).toMatchObject({ images: 2, total: 4, completed: 0, active: true });
    expect(seen.some((progress) => progress.tier === 'high')).toBe(true);
    // Finished: both tiers of both images counted, nothing left active.
    expect(seen[seen.length - 1]).toEqual({
      images: 2,
      total: 4,
      completed: 4,
      failed: 0,
      speed: 0,
      tier: null,
      active: false,
    });

    queue.stop();
    // Stopping resets the indicator to hidden.
    expect(queue.progress).toEqual({
      images: 0,
      total: 0,
      completed: 0,
      failed: 0,
      speed: 0,
      tier: null,
      active: false,
    });
  });

  it('restarts when start() supersedes a run that is still in flight', async () => {
    const cache = new FakeCache();
    const urls: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(String(url));
      // Hold the very first download so the second start() lands mid-run.
      if (urls.length === 1) await gate;
      return { ok: true, blob: async () => new Blob([new Uint8Array(10)]) };
    });
    const queue = new PrefetchQueue({
      cache: cache as unknown as PrefetchCache,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    queue.start('lib', [makeAsset('a')]);
    await flush(3);
    // Supersede mid-run with a different set of assets.
    queue.start('lib', [makeAsset('b')]);
    releaseFirst?.();
    await flush(16);
    queue.stop();

    // The superseded run must not swallow the new start(): b is fetched.
    expect(urls.some((url) => url.includes('/view/b'))).toBe(true);
  });

  it('downloads every tier when several run in parallel', async () => {
    const cache = new FakeCache();
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, blob: async () => new Blob([new Uint8Array(10)]) };
    });
    const queue = new PrefetchQueue({
      cache: cache as unknown as PrefetchCache,
      fetchImpl: fetchMock as unknown as typeof fetch,
      concurrency: 3,
    });

    queue.start('lib', [makeAsset('a'), makeAsset('b'), makeAsset('c')]);
    await flush(20);
    queue.stop();

    expect(new Set(urls)).toEqual(
      new Set([
        '/view/a',
        '/view/b',
        '/view/c',
        '/view/a?tier=high',
        '/view/b?tier=high',
        '/view/c?tier=high',
      ]),
    );
    // The whole low tier still goes first, even with a worker pool.
    expect(urls.slice(0, 3).some((url) => url.includes('tier=high'))).toBe(false);
  });

  it('binds the fetch implementation so it is not called with the queue as `this`', async () => {
    const cache = new FakeCache();
    const urls: string[] = [];
    // The browser's `fetch` throws `Illegal invocation` when called off the
    // global; emulate that so an unbound queue fails this test.
    function rawFetch(this: unknown, url: string): Promise<{ ok: boolean; blob: () => Promise<Blob> }> {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      urls.push(url);
      return Promise.resolve({ ok: true, blob: async () => new Blob([new Uint8Array(10)]) });
    }
    const queue = new PrefetchQueue({
      cache: cache as unknown as PrefetchCache,
      fetchImpl: rawFetch as unknown as typeof fetch,
    });

    queue.start('lib', [makeAsset('a')]);
    await flush(12);
    queue.stop();

    expect(urls.length).toBeGreaterThan(0);
  });

  it('reports a combined download speed while running', async () => {
    const cache = new FakeCache();
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { ok: true, blob: async () => new Blob([new Uint8Array(1000)]) };
    });
    const queue = new PrefetchQueue({
      cache: cache as unknown as PrefetchCache,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    // Enough assets at ~80ms each that the run is still active after a sample.
    const assets = Array.from({ length: 40 }, (_, index) => makeAsset(`a${index}`));
    queue.start('lib', assets);
    await new Promise((resolve) => setTimeout(resolve, 1600));

    expect(queue.progress.active).toBe(true);
    expect(queue.progress.speed).toBeGreaterThan(0);

    queue.stop();
    await flush(4);
  });
});
