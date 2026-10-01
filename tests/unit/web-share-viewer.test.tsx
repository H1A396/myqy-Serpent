// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';

vi.mock('../../src/myqy-web-share/client/api', () => ({
  sourceUrl: () => '/media/source',
  downloadUrl: () => '/media/download',
  viewUrl: (_libraryId: string, _asset: unknown, options?: { tier?: string }) =>
    options?.tier === 'high' ? '/media/view?tier=high' : '/media/view',
}));

const { cacheStore } = vi.hoisted(() => ({ cacheStore: new Map<string, Blob>() }));
vi.mock('../../src/myqy-web-share/client/prefetch-cache', () => ({
  prefetchCache: {
    get: async (key: { assetId: string; tier: string }) =>
      cacheStore.get(`${key.assetId}:${key.tier}`),
  },
}));

import { Viewer } from '../../src/myqy-web-share/client/Viewer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeAsset(assetId: string, displayName: string): AssetSummary {
  return {
    assetId,
    locationKind: 'managed',
    managedFolderId: null,
    relativeFilePath: displayName,
    displayName,
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
    thumbnailArtifactId: `thumb-${assetId}`,
    mediaType: 'image',
    width: 512,
    height: 512,
    durationMs: null,
  };
}

describe('web share Viewer', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    cacheStore.clear();
    let objectUrlCount = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => `blob:mock-${++objectUrlCount}`,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function renderViewer(onClose: () => void): Promise<void> {
    await act(async () => {
      root?.render(
        createElement(Viewer, {
          libraryId: 'lib-a',
          assets: [makeAsset('a1', 'one.png')],
          index: 0,
          allowDownload: true,
          marks: { favorite: false, rating: 0 },
          onMarksChange: () => undefined,
          onClose,
          onNavigate: () => undefined,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('closes when the empty area around the image is clicked', async () => {
    const onClose = vi.fn();
    await renderViewer(onClose);
    const body = container?.querySelector('.viewer-body');
    expect(body).not.toBeNull();
    act(() => {
      body?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the image itself is clicked', async () => {
    const onClose = vi.fn();
    await renderViewer(onClose);
    const image = container?.querySelector('.zoom-stage img');
    expect(image).not.toBeNull();
    act(() => {
      image?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the filename and page count in the header', async () => {
    await renderViewer(vi.fn());
    expect(container?.querySelector('.viewer-header-center .viewer-title')?.textContent).toBe(
      'one.png',
    );
    expect(container?.querySelector('.viewer-header-center .viewer-counter')?.textContent).toBe(
      '1 / 1',
    );
  });

  it('loads images through the bounded derivative instead of the source', async () => {
    await renderViewer(vi.fn());
    expect(container?.querySelector('.zoom-stage img')?.getAttribute('src')).toBe('/media/view');
  });

  it('marks the viewer image high priority so it wins over grid thumbnails', async () => {
    await renderViewer(vi.fn());
    const image = container?.querySelector('.zoom-stage img');
    expect(image?.getAttribute('fetchpriority')).toBe('high');
    expect(image?.getAttribute('decoding')).toBe('async');
  });

  it('starts on the low LOD tier and offers the high tier on zoom', async () => {
    await renderViewer(vi.fn());
    // The displayed layer starts on the default (82) tier; no high layer yet.
    const shown = container?.querySelector('.zoom-stage img:not(.zoom-layer-pending)');
    expect(shown?.getAttribute('src')).toBe('/media/view');
    expect(container?.querySelector('.zoom-layer-pending')).toBeNull();

    // Zoom in with the wheel: the component begins preloading the high tier.
    const stage = container?.querySelector('.zoom-stage img:not(.zoom-layer-pending)');
    await act(async () => {
      stage?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }));
    });
    // The high tier is layered on top (pending reveal), while the low tier stays
    // shown underneath so nothing flashes.
    const pending = container?.querySelector('.zoom-layer-pending');
    expect(pending?.getAttribute('src')).toBe('/media/view?tier=high');
    expect(
      container?.querySelector('.zoom-stage img:not(.zoom-layer-pending)')?.getAttribute('src'),
    ).toBe('/media/view');
  });

  it('keeps the zoom transform when the high tier swaps in', async () => {
    await renderViewer(vi.fn());
    const shown = container?.querySelector<HTMLImageElement>(
      '.zoom-stage img:not(.zoom-layer-pending)',
    );
    await act(async () => {
      shown?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }));
    });
    const before = shown?.getAttribute('style') ?? '';
    const scaleBefore = /scale\(([\d.]+)\)/u.exec(before)?.[1];

    // The pending layer finishes loading: it becomes the shown layer without a
    // remount, so the transform (and therefore zoom) is preserved.
    const pending = container?.querySelector<HTMLImageElement>('.zoom-layer-pending');
    await act(async () => {
      pending?.dispatchEvent(new Event('load'));
    });
    const after = container
      ?.querySelector<HTMLImageElement>('.zoom-stage img:not(.zoom-layer-pending)')
      ?.getAttribute('style') ?? '';
    const scaleAfter = /scale\(([\d.]+)\)/u.exec(after)?.[1];
    expect(scaleAfter).toBe(scaleBefore);
    expect(after).toBe(before);
  });

  it('offers a re-encoded Download and a Download original button', async () => {
    await renderViewer(vi.fn());
    const links = [...(container?.querySelectorAll('.viewer-header-right a') ?? [])];
    expect(links.map((element) => element.textContent)).toEqual([
      'Download',
      'Download original',
    ]);
    // The re-encode goes through the viewer endpoint; the original is the source.
    expect(links.map((element) => element.getAttribute('href'))).toEqual([
      '/media/view',
      '/media/download',
    ]);
    expect(links.every((element) => element.hasAttribute('download'))).toBe(true);
  });

  it('does not reuse the previous asset cached blob when navigating', async () => {
    cacheStore.set('a1:low', new Blob([new Uint8Array([1])]));
    const assets = [makeAsset('a1', 'one.png'), makeAsset('a2', 'two.png')];
    const renderAt = async (index: number): Promise<void> => {
      await act(async () => {
        root?.render(
          createElement(Viewer, {
            libraryId: 'lib-a',
            assets,
            index,
            allowDownload: true,
            marks: { favorite: false, rating: 0 },
            onMarksChange: () => undefined,
            onClose: () => undefined,
            onNavigate: () => undefined,
          }),
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await renderAt(0);
    expect(
      container?.querySelector('.zoom-stage img:not(.zoom-layer-pending)')?.getAttribute('src'),
    ).toMatch(/^blob:mock-/u);

    // a2 is not cached: it must fall back to the network, never the previous
    // asset's (now revoked) blob URL — which rendered a broken image.
    await renderAt(1);
    expect(
      container?.querySelector('.zoom-stage img:not(.zoom-layer-pending)')?.getAttribute('src'),
    ).toBe('/media/view');
  });
});
