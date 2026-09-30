// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';
import type { AssetDetail } from '../../src/myqy-web-share/client/api';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    config: vi.fn(),
    state: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    folders: vi.fn(),
    collections: vi.fn(),
    tags: vi.fn(),
    search: vi.fn(),
    asset: vi.fn(),
    marks: vi.fn(),
    setMarks: vi.fn(),
  },
}));

vi.mock('../../src/myqy-web-share/client/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    readonly status = 0;
    readonly code = '';
  },
  thumbnailUrl: (libraryId: string, assetId: string) =>
    `/media/thumbnail/${libraryId}/${assetId}`,
  sourceUrl: () => '/media/source',
  downloadUrl: () => '/media/download',
  viewUrl: () => '/media/view',
}));

import { App } from '../../src/myqy-web-share/client/App';

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

function makeDetail(
  asset: AssetSummary,
  marks?: { favorite: boolean; rating: number },
): AssetDetail {
  return {
    asset,
    metadata: {
      description: null,
      rating: asset.rating,
      favorite: asset.favorite,
      sourcePageUrl: null,
      author: null,
      tags: [],
    },
    extracted: { assetId: asset.assetId, status: 'missing', metadata: null },
    ...(marks === undefined ? {} : { marks }),
  };
}

const assets = [makeAsset('a1', 'one.png'), makeAsset('a2', 'two.png'), makeAsset('a3', 'three.png')];

describe('web share App selection', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    apiMock.config.mockResolvedValue({ app: 'Serpent', requiresPassword: false });
    apiMock.state.mockResolvedValue({
      app: 'Serpent',
      sharedLibraryId: 'lib-a',
      library: { libraryId: 'lib-a', displayName: 'Lib' },
      allowDownload: true,
      requiresPassword: false,
      username: 'tester',
    });
    apiMock.folders.mockResolvedValue({ folders: [] });
    apiMock.collections.mockResolvedValue({ collections: [] });
    apiMock.tags.mockResolvedValue({ tags: [] });
    apiMock.search.mockResolvedValue({ items: assets, total: assets.length, offset: 0 });
    apiMock.asset.mockImplementation((_libraryId: string, assetId: string) => {
      const asset = assets.find((candidate) => candidate.assetId === assetId);
      return Promise.resolve(asset === undefined ? undefined : makeDetail(asset));
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
    vi.clearAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }

  function clickCard(index: number): void {
    const card = container?.querySelectorAll('.card')[index];
    if (card === undefined) throw new Error(`card ${index} is missing`);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it('keeps the detail panel mounted when switching the selected asset', async () => {
    await act(async () => {
      root?.render(createElement(App));
    });
    await flush();

    clickCard(0);
    await flush();
    const panelAfterFirst = container?.querySelector('.detail');
    expect(panelAfterFirst).not.toBeNull();
    expect(container?.querySelector('.detail h2')?.textContent).toBe('one.png');

    // The regression: clearing `detail` on every click unmounted the panel,
    // collapsing the grid column and reflowing the whole grid (flicker).
    clickCard(1);
    await flush();
    expect(container?.querySelector('.detail')).toBe(panelAfterFirst);
    expect(container?.querySelector('.detail h2')?.textContent).toBe('two.png');
  });

  it('does not refetch the detail when the current asset is clicked again', async () => {
    await act(async () => {
      root?.render(createElement(App));
    });
    await flush();

    clickCard(0);
    await flush();
    expect(apiMock.asset).toHaveBeenCalledTimes(1);

    clickCard(0);
    await flush();
    expect(apiMock.asset).toHaveBeenCalledTimes(1);
  });

  it('uses an integer grid-density slider bounded to 5–15 columns', async () => {
    await act(async () => {
      root?.render(createElement(App));
    });
    await flush();

    const slider = container?.querySelector<HTMLInputElement>('.grid-density-slider');
    expect(slider).not.toBeNull();
    expect(slider?.type).toBe('range');
    expect(slider?.min).toBe('5');
    expect(slider?.max).toBe('15');
    expect(slider?.step).toBe('1');
    expect(slider?.value).toBe('5');

    await act(async () => {
      if (slider === null || slider === undefined) throw new Error('grid density slider missing');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '9');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container?.querySelector('.grid-density-value')?.textContent).toBe('9');
    expect(container?.querySelector('.grid')?.getAttribute('style')).toContain(
      'repeat(9, minmax(0, 1fr))',
    );
  });

  it('omits grid size badges and hides the removed detail facts', async () => {
    await act(async () => {
      root?.render(createElement(App));
    });
    await flush();

    expect(container?.querySelector('.card-badge')).toBeNull();
    clickCard(0);
    await flush();

    const info = container?.querySelector('.detail-section dl')?.textContent ?? '';
    expect(info).toContain('Type');
    expect(info).not.toContain('Dimensions');
    expect(info).not.toContain('Size');
    expect(info).not.toContain('Modified');
    expect(info).not.toContain('Path');
  });

  it('does not let a late mark read overwrite a fresh like', async () => {
    let resolveDetail: ((detail: AssetDetail) => void) | undefined;
    // The detail read (which carries the visitor's marks) is slow, as it is on a
    // tunnel; it must not clobber a like the visitor makes while it is in flight.
    apiMock.asset.mockImplementation(
      () =>
        new Promise<AssetDetail>((resolve) => {
          resolveDetail = resolve;
        }),
    );
    apiMock.setMarks.mockResolvedValue({ ok: true, marks: { favorite: true, rating: 0 } });

    await act(async () => {
      root?.render(createElement(App));
    });
    await flush();

    clickCard(0);
    await flush();

    const like = container?.querySelector('.mark-toggle');
    expect(like).not.toBeNull();
    expect(like?.getAttribute('aria-pressed')).toBe('false');
    like?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(container?.querySelector('.mark-toggle')?.getAttribute('aria-pressed')).toBe('true');

    // The stale detail lands afterwards with the visitor's old (false) mark.
    await act(async () => {
      resolveDetail?.(makeDetail(assets[0]!, { favorite: false, rating: 0 }));
      await Promise.resolve();
    });
    await flush();
    expect(container?.querySelector('.mark-toggle')?.getAttribute('aria-pressed')).toBe('true');
  });
});
