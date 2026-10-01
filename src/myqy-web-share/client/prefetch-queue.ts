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

/** Aggregate background-prefetch progress for the on-screen indicator. */
export interface PrefetchProgress {
  /** Number of image assets being prefetched (each contributes two tiers). */
  images: number;
  /** Total downloads to attempt (images x 2 tiers). */
  total: number;
  /** Downloads finished (successful cache writes), including skipped hits. */
  completed: number;
  /** Tier currently downloading, or `null` when idle/done. */
  tier: 'low' | 'high' | null;
  active: boolean;
}

export class PrefetchQueue {
  readonly #cache: PrefetchCache;
  readonly #fetchImpl: typeof fetch;
  readonly #gapMs: number;
  #paused = false;
  #running = false;
  /** A start()/resume() arrived mid-run; restart once the current run exits. */
  #restart = false;
  #generation = 0;
  #libraryId: string | null = null;
  #assets: readonly AssetSummary[] = [];
  readonly #listeners = new Set<(progress: PrefetchProgress) => void>();
  #progress: PrefetchProgress = { images: 0, total: 0, completed: 0, tier: null, active: false };

  constructor(options: PrefetchQueueOptions = {}) {
    this.#cache = options.cache ?? prefetchCache;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#gapMs = options.gapMs ?? 0;
  }

  /** Subscribe to progress changes; returns an unsubscribe function. */
  subscribe(listener: (progress: PrefetchProgress) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#progress);
    return () => this.#listeners.delete(listener);
  }

  get progress(): PrefetchProgress {
    return this.#progress;
  }

  #setProgress(next: Partial<PrefetchProgress>): void {
    this.#progress = { ...this.#progress, ...next };
    for (const listener of this.#listeners) listener(this.#progress);
  }

  /** Start (or restart) prefetching the given library's assets. */
  start(libraryId: string, assets: readonly AssetSummary[]): void {
    this.#libraryId = libraryId;
    this.#assets = assets;
    this.#generation += 1;
    this.#ensureRunning();
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
    this.#ensureRunning();
  }

  stop(): void {
    this.#generation += 1;
    this.#restart = false;
    this.#paused = false;
    this.#assets = [];
    this.#libraryId = null;
    this.#setProgress({ images: 0, total: 0, completed: 0, tier: null, active: false });
  }

  get paused(): boolean {
    return this.#paused;
  }

  /**
   * Guarantee a run is active. A call that arrives while a run is in flight is
   * remembered and starts fresh as soon as that run notices its generation was
   * superseded — otherwise a start() during a run (e.g. the page effect re-runs
   * after a transient 401) would be silently dropped and prefetching would
   * stop for good.
   */
  #ensureRunning(): void {
    if (this.#running) {
      this.#restart = true;
      return;
    }
    this.#restart = false;
    void this.#run(this.#generation);
  }

  async #run(generation: number): Promise<void> {
    this.#running = true;
    const images = this.#assets.filter((asset) => asset.mediaType === 'image');
    this.#setProgress({
      images: images.length,
      total: images.length * 2,
      completed: 0,
      tier: 'low',
      active: true,
    });
    try {
      // Whole library low tier first, then whole library high tier.
      for (const tier of ['low', 'high'] as const) {
        const libraryId = this.#libraryId;
        if (libraryId === null) return;
        this.#setProgress({ tier });
        for (const asset of images) {
          if (generation !== this.#generation) return;
          // Spin while paused so a resume continues without re-scanning.
          while (this.#paused) {
            if (generation !== this.#generation) return;
            await delay(this.#gapMs > 0 ? this.#gapMs : 200);
          }
          const descriptor = {
            libraryId,
            assetId: asset.assetId,
            revisionId: asset.currentRevisionId,
            tier,
          };
          if (await this.#cache.has(descriptor)) {
            this.#setProgress({ completed: this.#progress.completed + 1 });
            continue;
          }
          await this.#download(viewUrl(libraryId, asset, tier === 'high' ? { tier: 'high' } : undefined), descriptor, generation);
          this.#setProgress({ completed: this.#progress.completed + 1 });
          if (this.#gapMs > 0) await delay(this.#gapMs);
        }
      }
    } finally {
      this.#running = false;
      if (this.#restart) {
        // A newer start()/resume() superseded this run: hand over to it.
        this.#restart = false;
        this.#ensureRunning();
      } else if (generation === this.#generation) {
        this.#setProgress({ active: false, tier: null });
      }
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
