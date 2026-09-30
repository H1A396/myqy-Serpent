import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ViewerImageCache, loadViewerImage } from '../../src/myqy-web-share/client/viewer-image';

function chunkedResponse(body: number[]): Response {
  return {
    ok: true,
    status: 206,
    arrayBuffer: async () => new Uint8Array(body).buffer,
    blob: async () => new Blob([new Uint8Array(body)]),
  } as unknown as Response;
}

function wholeResponse(body: number[]): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(body).buffer,
    blob: async () => new Blob([new Uint8Array(body)]),
  } as unknown as Response;
}

function failed(status: number): Response {
  return { ok: false, status } as unknown as Response;
}

describe('viewer image chunk loader', () => {
  let blobs: Blob[];

  beforeEach(() => {
    blobs = [];
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = vi.fn(
      (blob: Blob) => {
        blobs.push(blob);
        return `blob:${blobs.length}`;
      },
    );
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests four chunks and concatenates them in order', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      const index = Number(/\d+$/u.exec(url)?.[0] ?? '0');
      return chunkedResponse([index, index]);
    }) as unknown as typeof fetch;

    const url = await loadViewerImage({
      url: '/media/view?revision=r1',
      key: 'k1',
      cache: new ViewerImageCache(),
      fetchImpl,
    });

    expect(url).toBe('blob:1');
    expect(urls).toEqual([
      '/media/view?revision=r1&chunk=0',
      '/media/view?revision=r1&chunk=1',
      '/media/view?revision=r1&chunk=2',
      '/media/view?revision=r1&chunk=3',
    ]);
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(
      new Uint8Array([0, 0, 1, 1, 2, 2, 3, 3]),
    );
  });

  it('uses the whole file when the server ignores the chunk parameter', async () => {
    const fetchImpl = vi.fn(async () => wholeResponse([7, 7, 7])) as unknown as typeof fetch;
    await loadViewerImage({
      url: '/media/view?revision=r1',
      key: 'k1',
      cache: new ViewerImageCache(),
      fetchImpl,
    });
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('retries a chunk that fails before succeeding', async () => {
    const attempts = new Map<string, number>();
    const fetchImpl = vi.fn(async (url: string) => {
      const count = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, count);
      if (url.endsWith('chunk=2') && count === 1) return failed(500);
      return chunkedResponse([1]);
    }) as unknown as typeof fetch;

    await loadViewerImage({
      url: '/media/view?revision=r1',
      key: 'k1',
      cache: new ViewerImageCache(),
      fetchImpl,
    });
    expect(attempts.get('/media/view?revision=r1&chunk=2')).toBe(2);
  });

  it('falls back to a single whole-file request when chunks keep failing', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('chunk=')) return failed(500);
      return wholeResponse([4, 2]);
    }) as unknown as typeof fetch;

    await loadViewerImage({
      url: '/media/view?revision=r1',
      key: 'k1',
      cache: new ViewerImageCache(),
      fetchImpl,
    });
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(new Uint8Array([4, 2]));
  });

  it('serves a cached image without refetching', async () => {
    const cache = new ViewerImageCache();
    const fetchImpl = vi.fn(async () => chunkedResponse([1])) as unknown as typeof fetch;

    const first = await loadViewerImage({ url: '/media/view', key: 'same', cache, fetchImpl });
    const second = await loadViewerImage({ url: '/media/view', key: 'same', cache, fetchImpl });

    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('revokes the oldest object URL when the cache evicts', () => {
    const cache = new ViewerImageCache(2);
    cache.set('a', 'blob:a');
    cache.set('b', 'blob:b');
    cache.set('c', 'blob:c');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe('blob:c');
  });
});