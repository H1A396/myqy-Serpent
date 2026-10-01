import { describe, expect, it, vi } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';
import type { PrefetchCache, PrefetchCacheKey } from '../../src/myqy-web-share/client/prefetch-cache';
import { PrefetchQueue } from '../../src/myqy-web-share/client/prefetch-queue';
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
  async put(input: PrefetchCacheKey, blob: Blob): Promise<void> {
    this.stored.set(this.privateKey(input), blob.size);
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
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array(10)]),
    }));
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
    const fetchMock = vi.fn(async (_url: string) => ({
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
});
