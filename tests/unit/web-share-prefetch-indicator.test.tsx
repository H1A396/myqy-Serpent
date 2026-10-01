// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrefetchProgress } from '../../src/myqy-web-share/client/prefetch-queue';

const { queueMock } = vi.hoisted(() => {
  const listeners = new Set<(progress: PrefetchProgress) => void>();
  let current: PrefetchProgress = { images: 0, total: 0, completed: 0, failed: 0, speed: 0, tier: null, active: false };
  return {
    queueMock: {
      subscribe(listener: (progress: PrefetchProgress) => void) {
        listeners.add(listener);
        listener(current);
        return () => listeners.delete(listener);
      },
      get progress(): PrefetchProgress {
        return current;
      },
      set(next: PrefetchProgress) {
        current = next;
        for (const listener of listeners) listener(current);
      },
    },
  };
});

vi.mock('../../src/myqy-web-share/client/prefetch-queue', () => ({
  prefetchQueue: queueMock,
}));

import { PrefetchIndicator, tierCompletion } from '../../src/myqy-web-share/client/PrefetchIndicator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function progress(partial: Partial<PrefetchProgress>): PrefetchProgress {
  return { images: 0, total: 0, completed: 0, failed: 0, speed: 0, tier: null, active: false, ...partial };
}

describe('PrefetchIndicator', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  async function render(): Promise<void> {
    await act(async () => {
      root?.render(createElement(PrefetchIndicator));
    });
  }

  async function emit(next: PrefetchProgress): Promise<void> {
    await act(async () => {
      queueMock.set(next);
    });
  }

  it('derives per-tier completion from the low-then-high order', () => {
    expect(tierCompletion(progress({ images: 5, total: 10, completed: 0 }))).toEqual({
      low: 0,
      high: 0,
    });
    expect(tierCompletion(progress({ images: 5, total: 10, completed: 5 }))).toEqual({
      low: 5,
      high: 0,
    });
    expect(tierCompletion(progress({ images: 5, total: 10, completed: 7 }))).toEqual({
      low: 5,
      high: 2,
    });
    expect(tierCompletion(progress({ images: 5, total: 10, completed: 10 }))).toEqual({
      low: 5,
      high: 5,
    });
  });

  it('stays hidden while idle', async () => {
    await render();
    expect(container?.querySelector('.prefetch-indicator')).toBeNull();
  });

  it('shows both tiers with counts while prefetching', async () => {
    await render();
    await emit(progress({ images: 5, total: 10, completed: 3, tier: 'low', active: true }));

    const tiers = container?.querySelectorAll('.prefetch-tier') ?? [];
    expect(tiers.length).toBe(2);
    const labels = [...tiers].map((tier) => tier.querySelector('.prefetch-tier-label')?.textContent);
    expect(labels).toEqual(['82', '100']);
    const counts = [...tiers].map((tier) => tier.querySelector('.prefetch-tier-count')?.textContent);
    expect(counts).toEqual(['3/5', '0/5']);
    expect(tiers[0]?.getAttribute('data-active')).toBe('true');
    expect(tiers[1]?.getAttribute('data-active')).toBe('false');
    expect(tiers[0]?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3');
  });

  it('shows the combined download speed while prefetching', async () => {
    await render();
    await emit(
      progress({ images: 5, total: 10, completed: 3, speed: 2 * 1024 * 1024, tier: 'low', active: true }),
    );
    expect(container?.querySelector('.prefetch-speed')?.textContent).toBe('2.0 MB/s');
  });

  it('advances the high tier once the low tier is complete', async () => {
    await render();
    await emit(progress({ images: 5, total: 10, completed: 7, tier: 'high', active: true }));

    const counts = [...(container?.querySelectorAll('.prefetch-tier-count') ?? [])].map(
      (node) => node.textContent,
    );
    expect(counts).toEqual(['5/5', '2/5']);
    expect(
      container?.querySelectorAll('.prefetch-tier')[1]?.getAttribute('data-active'),
    ).toBe('true');
  });

  it('lingers briefly after both tiers are cached, then hides', async () => {
    await render();
    vi.useFakeTimers();
    try {
      await emit(progress({ images: 5, total: 10, completed: 10, tier: null, active: false }));
      // Still on screen right after finishing, so it is not missed.
      expect(container?.querySelector('.prefetch-indicator')).not.toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });
      expect(container?.querySelector('.prefetch-indicator')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
