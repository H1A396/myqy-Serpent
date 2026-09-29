// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';

vi.mock('../../src/myqy-web-share/client/api', () => ({
  sourceUrl: () => '/media/source',
  downloadUrl: () => '/media/download',
  viewUrl: () => '/media/view',
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

  function renderViewer(onClose: () => void): void {
    act(() => {
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
  }

  it('closes when the empty area around the image is clicked', () => {
    const onClose = vi.fn();
    renderViewer(onClose);
    const body = container?.querySelector('.viewer-body');
    expect(body).not.toBeNull();
    act(() => {
      body?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the image itself is clicked', () => {
    const onClose = vi.fn();
    renderViewer(onClose);
    const image = container?.querySelector('.zoom-stage img');
    expect(image).not.toBeNull();
    act(() => {
      image?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the filename and page count in the header', () => {
    renderViewer(vi.fn());
    expect(container?.querySelector('.viewer-header-center .viewer-title')?.textContent).toBe(
      'one.png',
    );
    expect(container?.querySelector('.viewer-header-center .viewer-counter')?.textContent).toBe(
      '1 / 1',
    );
  });

  it('loads images through the bounded derivative instead of the source', () => {
    renderViewer(vi.fn());
    expect(container?.querySelector('.zoom-stage img')?.getAttribute('src')).toBe('/media/view');
  });

  it('offers a re-encoded Download and a Download original button', () => {
    renderViewer(vi.fn());
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
});
