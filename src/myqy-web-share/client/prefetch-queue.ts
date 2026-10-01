import { viewUrl } from './api';
import type { AssetSummary } from '../../shared/asset-types';
import { prefetchCache, type PrefetchCache } from './prefetch-cache';

/**
 * Background viewer-image prefetcher.
 *
 * After the visitor reaches the main page, this downloads every image asset's
 * two LOD tiers (WebP 82, then 100) into the persistent cache, so opening the
 * viewer — and zooming in — is usually a cache hit.
 *
 * Scheduling rules (product decisions):
 * - **Thumbnails outrank this.** The grid's own visible-window thumbnail work
 *   stays highest priority; this runs afterward, low priority, and pauses.
 * - **Pause while the viewer is open.** The visitor's active image gets the
 *   whole tunnel; prefetching resumes (from where it stopped, not from the
 *   start) once the viewer closes.
 * - **Low tier first, whole library, then high tier.**
 * - It never re-downloads what the cache already holds, and it is bounded by
 *   the cache's own 1 GiB LRU.
 */

export interface PrefetchQueueOptions {
  cache?: PrefetchCache;
  fetchImpl?: typeof fetch;
  /** Delay between starting one download and the next (throttles the tunnel). */
  gapMs?: number;
}

export class PrefetchQueue {
  readonly #cache: PrefetchCache;
  readonly #fetchImpl: typeof fetch;
  readonly #gapMs: number;
  #paused = false;
  #running = false;
  #generation = 0;
  #libraryId: string | null = null;
  #assets: readonly AssetSummary[] = [];

  constructor(options: PrefetchQueueOptions = {}) {
    this.#cache = options.cache ?? prefetchCache;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#gapMs = options.gapMs ?? 0;
  }

  /** Start (or restart) prefetching the given library's assets. */
  start(libraryId: string, assets: readonly AssetSummary[]): void {
    this.#libraryId = libraryId;
    this.#assets = assets;
    this.#generation += 1;
    if (!this.#running) void this.#run(this.#generation);
  }

  setAssets(libraryId: string, assets: readonly AssetSummary[]): void {
    if (this.#libraryId !== libraryId) {
      this.start(libraryId, assets);
      return;
    }
    this.#assets = assets;
  }

  /** The viewer opened: stop starting new downloads. */
  pause(): void {
    this.#paused = true;
  }

  /** The viewer closed: resume from where it stopped. */
  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    if (!this.#running) void this.#run(this.#generation);
  }

  stop(): void {
    this.#generation += 1;
    this.#paused = false;
    this.#assets = [];
    this.#libraryId = null;
  }

  get paused(): boolean {
    return this.#paused;
  }

  async #run(generation: number): Promise<void> {
    this.#running = true;
    try {
      // Whole library low tier first, then whole library high tier.
      for (const tier of ['low', 'high'] as const) {
        const libraryId = this.#libraryId;
        if (libraryId === null) return;
        for (const asset of this.#assets) {
          if (generation !== this.#generation) return;
          // Spin while paused so a resume continues without re-scanning.
          while (this.#paused) {
            if (generation !== this.#generation) return;
            await delay(this.#gapMs > 0 ? this.#gapMs : 200);
          }
          if (asset.mediaType !== 'image') continue;
          const descriptor = {
            libraryId,
            assetId: asset.assetId,
            revisionId: asset.currentRevisionId,
            tier,
          };
          if (await this.#cache.has(descriptor)) continue;
          await this.#download(viewUrl(libraryId, asset, tier === 'high' ? { tier: 'high' } : undefined), descriptor, generation);
          if (this.#gapMs > 0) await delay(this.#gapMs);
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #download(url: string, descriptor: {
    libraryId: string;
    assetId: string;
    revisionId: string;
    tier: 'low' | 'high';
  }, generation: number): Promise<void> {
    try {
      const response = await this.#fetchImpl(url, {
        // Low priority so the grid's thumbnails and any on-screen image win.
        fetchPriority: 'low',
        credentials: 'same-origin',
      } as RequestInit);
      if (!response.ok) return;
      if (generation !== this.#generation) return;
      const blob = await response.blob();
      if (generation !== this.#generation) return;
      await this.#cache.put(descriptor, blob);
    } catch {
      // Network hiccup / aborted; the next pass retries.
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const prefetchQueue = new PrefetchQueue();
