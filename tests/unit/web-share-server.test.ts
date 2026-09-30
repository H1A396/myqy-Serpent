import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetMetadataResult,
  AssetSummary,
  CollectionSummary,
  ExtractedMetadataResult,
  FolderBrowseEntry,
  LinkedFolderSummary,
  ManagedFolderSummary,
  TagSummary,
} from '../../src/shared/asset-types';
import { WebShareDataError } from '../../src/myqy-web-share/server/web-share-data';
import type {
  WebShareAssetQuery,
  WebShareDataProvider,
} from '../../src/myqy-web-share/server/web-share-data';
import { WebShareServer } from '../../src/myqy-web-share/server/web-share-server';
import type { ResolvedDerivative, ResolvedMedia, WebShareMediaResolver } from '../../src/myqy-web-share/server/web-share-media';
import {
  WEB_SHARE_DEFAULT_DOWNLOAD_QUALITY,
  WEB_SHARE_DERIVATIVE_QUALITY,
} from '../../src/shared/web-share';
import type { WebShareLibrarySummary } from '../../src/shared/web-share';

function emptyAsset(): AssetSummary {
  return {
    assetId: 'asset-1',
    locationKind: 'managed',
    managedFolderId: null,
    relativeFilePath: 'a.png',
    displayName: 'a.png',
    currentRevisionId: 'rev-1',
    byteSize: 10,
    modifiedAt: '2024-01-01T00:00:00.000Z',
    availability: 'available',
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: 'image',
    width: 10,
    height: 10,
    durationMs: null,
  };
}

class FakeDataProvider implements WebShareDataProvider {
  public lastSearch: WebShareAssetQuery | undefined;

  constructor(private readonly libraries: WebShareLibrarySummary[]) {}

  async listLibraries(): Promise<WebShareLibrarySummary[]> {
    return this.libraries;
  }

  async listFolders(libraryId: string): Promise<ManagedFolderSummary[]> {
    if (libraryId !== 'lib-a') return [];
    return [
      {
        folderId: 'folder-1',
        parentFolderId: null,
        name: 'Folder One',
        relativePath: 'Folder One',
        directAssetCount: 1,
        childFolderCount: 0,
      },
    ];
  }

  async listLinkedFolders(): Promise<LinkedFolderSummary[]> {
    return [];
  }

  async browseEntries(): Promise<FolderBrowseEntry[]> {
    return [];
  }

  async searchAssets(input: WebShareAssetQuery): Promise<{ items: AssetSummary[]; total: number; offset: number }> {
    this.lastSearch = input;
    return { items: [emptyAsset()], total: 1, offset: input.offset ?? 0 };
  }

  async listAssets(input: {
    libraryId: string;
    folderId: string | null;
    recursive: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AssetSummary[]; total: number; offset: number }> {
    return this.searchAssets({
      libraryId: input.libraryId,
      query: { clauses: [] },
      scope: { kind: 'folder', folderId: input.folderId, recursive: input.recursive },
      limit: input.limit,
      offset: input.offset,
    });
  }

  async listCollectionAssets(input: {
    libraryId: string;
    collectionId: string;
    recursive: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AssetSummary[]; total: number; offset: number }> {
    return { items: [], total: 0, offset: input.offset ?? 0 };
  }

  async getAssetDetail(input?: { libraryId: string; assetId: string }): Promise<{
    asset: AssetSummary;
    metadata: AssetMetadataResult;
    extracted: ExtractedMetadataResult;
  }> {
    if (input?.assetId === 'missing') {
      throw new WebShareDataError('WEB_SHARE_ASSET_NOT_FOUND');
    }
    return {
      asset: emptyAsset(),
      metadata: {
        assetId: 'asset-1',
        description: null,
        rating: 0,
        favorite: false,
        palette: null,
        automaticPalette: [],
        effectivePalette: [],
        paletteSource: null,
        sourcePageUrl: null,
        author: null,
        tags: [],
        entityVersion: 0,
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      extracted: {
        assetId: 'asset-1',
        status: 'missing',
        metadata: null,
        metadataCompleteness: 'complete',
        errorCode: null,
      },
    };
  }

  async listTags(): Promise<TagSummary[]> {
    return [];
  }

  async listCollections(): Promise<CollectionSummary[]> {
    return [];
  }
}

class FakeMediaResolver implements WebShareMediaResolver {
  constructor(private readonly paths: Record<string, string>) {}

  async resolveThumbnail(input: { libraryId: string; assetId: string }): Promise<ResolvedMedia | null> {
    return this.#resolve('thumbnail', input.assetId, 'image/webp');
  }

  async resolveSource(input: { libraryId: string; assetId: string; revisionId: string }): Promise<ResolvedMedia | null> {
    return this.#resolve('source', input.assetId, 'video/mp4');
  }

  async resolveArtifact(input: { libraryId: string; artifactId: string; kind: 'preview' | 'proxy' }): Promise<ResolvedMedia | null> {
    return this.#resolve('preview', input.artifactId, 'video/webm');
  }

  async resolveDerivative(input: {
    libraryId: string;
    assetId: string;
    revisionId: string;
    format: 'webp' | 'jpeg' | 'png';
    maxEdge: number;
    quality: number;
    fullSize: boolean;
    progressive: boolean;
  }): Promise<ResolvedDerivative | null> {
    this.lastDerivative = {
      format: input.format,
      maxEdge: input.maxEdge,
      quality: input.quality,
      fullSize: input.fullSize,
      progressive: input.progressive,
    };
    const resolved = this.#resolve('view', input.assetId, `image/${input.format}`);
    if (resolved === null) return null;
    return {
      ...resolved,
      cached: this.derivativeCached,
      cleanup: () => {
        this.derivativeCleanupCount += 1;
      },
    };
  }

  async resolveThumbnailDerivative(input: {
    libraryId: string;
    assetId: string;
    format: 'webp' | 'jpeg' | 'png';
    maxEdge: number;
    sharpen: boolean;
    maxBytes: number;
  }): Promise<ResolvedDerivative | null> {
    if (this.thumbnailDerivativeUnavailable) return null;
    const resolved = this.#resolve('thumbview', input.assetId, `image/${input.format}`);
    if (resolved === null) return null;
    return {
      ...resolved,
      cached: true,
      cleanup: () => {
        this.derivativeCleanupCount += 1;
      },
    };
  }

  /** Simulates a still-generating thumbnail that forces the artifact fallback. */
  thumbnailDerivativeUnavailable = false;

  /** When true, the viewer derivative comes from the persistent cache. */
  derivativeCached = false;

  /** Parameters of the last viewer derivative the server requested. */
  lastDerivative: {
    format: string;
    maxEdge: number;
    quality: number;
    fullSize: boolean;
    progressive: boolean;
  } | null = null;

  /** Number of times a served derivative reported itself as discarded. */
  derivativeCleanupCount = 0;

  #resolve(kind: string, id: string, mimeType: string): ResolvedMedia | null {
    const absolutePath = this.paths[`${kind}:${id}`];
    return absolutePath === undefined ? null : { absolutePath, mimeType };
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (typeof address !== 'object' || address === null) {
        probe.close(() => reject(new Error('No probe port.')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/** Send an unnormalized request path that fetch() would rewrite. */
function rawGet(origin: string, rawPath: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const request = httpRequest(
      { host: url.hostname, port: url.port, path: rawPath, method: 'GET' },
      (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

describe('WebShareServer', () => {
  let userDataPath: string;
  let server: WebShareServer;
  let provider: FakeDataProvider;
  let media: FakeMediaResolver;
  let baseUrl: string;
  let mediaPaths: Record<string, string>;

  beforeEach(async () => {
    userDataPath = await mkdtemp(path.join(os.tmpdir(), 'serpent-web-share-'));
    mediaPaths = {
      'thumbnail:asset-1': path.join(userDataPath, 'thumb.webp'),
      'thumbview:asset-1': path.join(userDataPath, 'thumb-128.webp'),
      'source:asset-1': path.join(userDataPath, 'clip.mp4'),
      'preview:art-1': path.join(userDataPath, 'preview.webm'),
      'view:asset-1': path.join(userDataPath, 'derivative.webp'),
    };
    await writeFile(mediaPaths['thumbnail:asset-1']!, Buffer.from('thumb-bytes'));
    await writeFile(mediaPaths['thumbview:asset-1']!, Buffer.from('thumb-128-bytes'));
    await writeFile(mediaPaths['source:asset-1']!, Buffer.from('0123456789'));
    await writeFile(mediaPaths['preview:art-1']!, Buffer.from('preview-bytes'));
    await writeFile(mediaPaths['view:asset-1']!, Buffer.from('derivative-bytes'));
    provider = new FakeDataProvider([
      { libraryId: 'lib-a', displayName: 'Library A' },
      { libraryId: 'lib-b', displayName: 'Library B' },
    ]);
    media = new FakeMediaResolver(mediaPaths);
    server = new WebShareServer({
      userDataPath,
      data: provider,
      media,
      logger: { info: () => undefined, error: () => undefined },
    });
    const port = await getFreePort();
    await server.setPort(port);
    await server.setEnabled(true);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.close();
    await rm(userDataPath, { recursive: true, force: true });
  });

  async function login(
    password: string,
    username = 'tester',
  ): Promise<{ status: number; cookie?: string }> {
    const response = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const setCookie = response.headers.get('set-cookie');
    return {
      status: response.status,
      ...(setCookie === null ? {} : { cookie: setCookie.split(';')[0]! }),
    };
  }

  it('answers health without authentication', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ app: 'Serpent' });
  });

  it('reports whether a password is required, and reveals debug only locally', async () => {
    const response = await fetch(`${baseUrl}/api/config`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      app: 'Serpent',
      requiresPassword: false,
      debug: true,
    });
  });

  it('hides debug from a request that came through a tunnel', async () => {
    const response = await new Promise<{ body: unknown }>((resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port: Number(new URL(baseUrl).port),
          path: '/api/config',
          method: 'GET',
          headers: { 'cf-connecting-ip': '203.0.113.9' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    });
    expect((response.body as { debug: boolean }).debug).toBe(false);
  });

  it('requires a session even when no password is configured', async () => {
    const response = await fetch(`${baseUrl}/api/state`);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('WEB_SHARE_UNAUTHORIZED');
  });

  it('signs a visitor in with only a username when no password is set', async () => {
    const { status, cookie } = await login('', 'alice');
    expect(status).toBe(200);
    const state = await fetch(`${baseUrl}/api/state`, { headers: { Cookie: cookie! } });
    expect(state.status).toBe(200);
    const body = (await state.json()) as { username: string; requiresPassword: boolean };
    expect(body.username).toBe('alice');
    expect(body.requiresPassword).toBe(false);
  });

  it("stores a visitor's own likes and ratings without touching the library", async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery', 'bob');
    const headers = { Cookie: cookie!, 'Content-Type': 'application/json' };

    const before = await fetch(`${baseUrl}/api/libraries/lib-a/assets/asset-1`, { headers });
    expect(((await before.json()) as { marks: unknown }).marks).toEqual({ favorite: false, rating: 0 });

    const updated = await fetch(`${baseUrl}/api/libraries/lib-a/assets/asset-1/marks`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ favorite: true, rating: 4 }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { marks: unknown }).marks).toEqual({ favorite: true, rating: 4 });

    const fetched = await fetch(`${baseUrl}/api/libraries/lib-a/assets/asset-1/marks`, { headers });
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as { marks: unknown }).marks).toEqual({
      favorite: true,
      rating: 4,
    });

    // A different visitor sees their own empty marks, never bob's.
    const other = await login('correct horse battery', 'carol');
    const otherDetail = await fetch(`${baseUrl}/api/libraries/lib-a/assets/asset-1`, {
      headers: { Cookie: other.cookie! },
    });
    expect(((await otherDetail.json()) as { marks: unknown }).marks).toEqual({
      favorite: false,
      rating: 0,
    });

    // The operator's records panel sees bob's mark with the asset name.
    const bob = server.listVisitors().find((visitor) => visitor.username === 'bob');
    expect(bob?.marks).toHaveLength(1);
    expect(bob?.marks[0]).toMatchObject({
      assetId: 'asset-1',
      favorite: true,
      rating: 4,
      assetName: 'a.png',
    });
  });

  it('rejects a mark for an asset that is not in the shared library', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery', 'bob');
    const response = await fetch(`${baseUrl}/api/libraries/lib-a/assets/missing/marks`, {
      method: 'PUT',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    expect(response.status).toBe(404);
  });

  it('rejects an empty mark payload', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery', 'bob');
    const response = await fetch(`${baseUrl}/api/libraries/lib-a/assets/asset-1/marks`, {
      method: 'PUT',
      headers: { Cookie: cookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('issues a session cookie for the configured password', async () => {
    server.setPassword('correct horse battery');
    expect((await login('wrong password')).status).toBe(401);
    const { status, cookie } = await login('correct horse battery');
    expect(status).toBe(200);
    expect(cookie).toBeDefined();
    const state = await fetch(`${baseUrl}/api/state`, { headers: { Cookie: cookie! } });
    expect(state.status).toBe(200);
    const body = (await state.json()) as { sharedLibraryId: string; library: { displayName: string } };
    expect(body.sharedLibraryId).toBe('lib-a');
    expect(body.library.displayName).toBe('Library A');
  });

  it('requires authentication for API routes', async () => {
    server.setPassword('correct horse battery');
    const response = await fetch(`${baseUrl}/api/state`);
    expect(response.status).toBe(401);
  });

  it('serves only the shared library', async () => {
    server.setPassword('correct horse battery');
    server.setLibrary('lib-b');
    const { cookie } = await login('correct horse battery');
    const headers = { Cookie: cookie! };
    expect((await fetch(`${baseUrl}/api/libraries/lib-b/folders`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/libraries/lib-a/folders`, { headers })).status).toBe(404);
  });

  it('returns folders for the shared library', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/api/libraries/lib-a/folders`, {
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { folders: Array<{ name: string }> };
    expect(body.folders.map((folder) => folder.name)).toEqual(['Folder One']);
  });

  it('parses search query, filters and sort', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(
      `${baseUrl}/api/libraries/lib-a/search?q=hero&format=png&tag=red,blue&favorite=yes&sort=name&order=desc&limit=10`,
      { headers: { Cookie: cookie! } },
    );
    expect(response.status).toBe(200);
    const captured = provider.lastSearch;
    expect(captured?.query.clauses).toEqual([
      { field: null, values: ['hero'], exclude: false },
    ]);
    const filters = captured?.filters ?? [];
    expect(filters).toContainEqual({ field: 'format', values: ['png'], exclude: false });
    expect(filters).toContainEqual({ field: 'tag', values: ['red', 'blue'], exclude: false, includeAi: true });
    expect(filters).toContainEqual({ field: 'favorite', values: [], exclude: false });
    expect(captured?.sort).toEqual({ field: 'name', order: 'desc' });
    expect(captured?.limit).toBe(10);
  });

  it('rejects write methods on the API', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/api/libraries/lib-a/folders`, {
      method: 'POST',
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(405);
  });

  it('invalidates sessions when the password changes', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    server.setPassword('a different password');
    const response = await fetch(`${baseUrl}/api/state`, { headers: { Cookie: cookie! } });
    expect(response.status).toBe(401);
  });

  it('throttles repeated wrong passwords', async () => {
    server.setPassword('correct horse battery');
    for (let attempt = 0; attempt < 5; attempt += 1) await login('nope');
    const blocked = await login('correct horse battery');
    expect(blocked.status).toBe(429);
  });

  it('reports a missing web client instead of serving files', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/`, { headers: { Cookie: cookie! } });
    expect(response.status).toBe(503);
  });

  it('requires authentication for media', async () => {
    server.setPassword('correct horse battery');
    const response = await fetch(`${baseUrl}/media/thumbnail/lib-a/asset-1`);
    expect(response.status).toBe(401);
  });

  it('serves a downscaled, cacheable thumbnail for the shared library', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/media/thumbnail/lib-a/asset-1`, {
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    // Grid thumbnails are the bounded derivative, cached like the card artifact.
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await response.text()).toBe('thumb-128-bytes');
  });

  it('falls back to the card artifact when the thumbnail derivative is not ready', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    media.thumbnailDerivativeUnavailable = true;
    const response = await fetch(`${baseUrl}/media/thumbnail/lib-a/asset-1`, {
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await response.text()).toBe('thumb-bytes');
  });

  it('serves source byte ranges', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/media/source/lib-a/asset-1?revision=rev-1`, {
      headers: { Cookie: cookie!, Range: 'bytes=0-3' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/10');
    expect(await response.text()).toBe('0123');
  });

  it('gates explicit downloads behind the preference', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    server.setAllowDownload(false);
    const blocked = await fetch(
      `${baseUrl}/media/source/lib-a/asset-1?revision=rev-1&download=1`,
      { headers: { Cookie: cookie! } },
    );
    expect(blocked.status).toBe(403);
    server.setAllowDownload(true);
    const allowed = await fetch(
      `${baseUrl}/media/source/lib-a/asset-1?revision=rev-1&download=1`,
      { headers: { Cookie: cookie! } },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('content-disposition')).toContain('attachment');
  });

  it('serves and then discards a bounded derivative', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    media.derivativeCleanupCount = 0;
    const response = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1`,
      { headers: { Cookie: cookie! } },
    );
    expect(response.status).toBe(200);
    // The on-screen image is the bounded WebP.
    expect(response.headers.get('content-type')).toBe('image/webp');
    // The on-screen image is reusable in the visitor's own browser.
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(await response.text()).toBe('derivative-bytes');
    // Discarding is bound to the response 'close' event, which fires once the
    // body has been flushed.
    await vi.waitFor(() => expect(media.derivativeCleanupCount).toBe(1));
  });

  it('requires a revision for a derivative', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/media/view/lib-a/asset-1`, {
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(400);
  });

  it('serves a cached viewer derivative as four contiguous byte-range chunks', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    media.derivativeCached = true;
    media.derivativeCleanupCount = 0;

    const bodies: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await fetch(
        `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1&chunk=${index}`,
        { headers: { Cookie: cookie! } },
      );
      expect(response.status).toBe(206);
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
      bodies.push(await response.text());
    }
    // 16 bytes split 4 ways, contiguous and non-overlapping.
    expect(bodies).toEqual(['deri', 'vati', 've-b', 'ytes']);
    expect(bodies.join('')).toBe('derivative-bytes');
    // A cached file is never deleted.
    expect(media.derivativeCleanupCount).toBe(0);
  });

  it('reports an out-of-range chunk index with 416', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    media.derivativeCached = true;
    const response = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1&chunk=9`,
      { headers: { Cookie: cookie! } },
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */16');
  });

  it('answers a HEAD chunk request with headers and no body', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    media.derivativeCached = true;
    const response = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1&chunk=1`,
      { method: 'HEAD', headers: { Cookie: cookie! } },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-length')).toBe('4');
    expect(await response.text()).toBe('');
  });

  it('ignores the chunk parameter for downloads', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    media.derivativeCached = true;
    const response = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1&download=1&chunk=0`,
      { headers: { Cookie: cookie! } },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('derivative-bytes');
  });


  it('re-encodes the download as a full-resolution JPEG at the configured quality', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1&download=1`,
      { headers: { Cookie: cookie! } },
    );
    expect(response.status).toBe(200);
    expect(media.lastDerivative).toMatchObject({
      format: 'jpeg',
      fullSize: true,
      progressive: false,
      quality: WEB_SHARE_DEFAULT_DOWNLOAD_QUALITY,
    });
  });

  it('keeps the on-screen viewer derivative bounded and fullSize=false', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1`,
      { headers: { Cookie: cookie! } },
    );
    expect(response.status).toBe(200);
    expect(media.lastDerivative).toMatchObject({
      format: 'webp',
      fullSize: false,
      quality: WEB_SHARE_DERIVATIVE_QUALITY,
    });
  });

  it('gates derivative downloads behind the preference and always cleans up', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    server.setAllowDownload(false);
    media.derivativeCleanupCount = 0;
    const blocked = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1&download=1`,
      { headers: { Cookie: cookie! } },
    );
    expect(blocked.status).toBe(403);
    // The download is refused before any derivative is encoded, so there is
    // nothing to leak and nothing to clean up.
    expect(media.derivativeCleanupCount).toBe(0);
    server.setAllowDownload(true);
    const allowed = await fetch(
      `${baseUrl}/media/view/lib-a/asset-1?revision=rev-1&download=1`,
      { headers: { Cookie: cookie! } },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('content-disposition')).toContain('attachment');
    // A download must not be replayed from a browser cache.
    expect(allowed.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects media from a non-shared library', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/media/thumbnail/lib-b/asset-1`, {
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(404);
  });

  it('returns 404 for media the Worker cannot resolve', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/media/thumbnail/lib-a/unknown`, {
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(404);
  });

  it('serves the built web client and falls back to index.html', async () => {
    const staticRoot = path.join(userDataPath, 'web');
    await mkdir(staticRoot, { recursive: true });
    await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>Serpent</title>');
    await writeFile(path.join(staticRoot, 'app.js'), 'console.log(1);');
    const previewRoot = path.join(staticRoot, 'web-preview');
    await mkdir(path.join(previewRoot, 'assets'), { recursive: true });
    await writeFile(path.join(previewRoot, 'index.html'), '<!doctype html><title>Preview build</title>');
    await writeFile(path.join(previewRoot, 'assets', 'preview.js'), 'console.log("preview");');
    const port = await getFreePort();
    const staticServer = new WebShareServer({
      userDataPath: path.join(userDataPath, 'static-data'),
      data: provider,
      staticRootDir: staticRoot,
      logger: { info: () => undefined, error: () => undefined },
    });
    await staticServer.setPort(port);
    await staticServer.setEnabled(true);
    try {
      const origin = `http://127.0.0.1:${port}`;
      const index = await fetch(`${origin}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('Serpent');

      const directoryWithoutSlash = await fetch(`${origin}/web-preview`, { redirect: 'manual' });
      expect(directoryWithoutSlash.status).toBe(301);
      expect(directoryWithoutSlash.headers.get('location')).toBe('/web-preview/');

      const previewIndex = await fetch(`${origin}/web-preview/`);
      expect(previewIndex.status).toBe(200);
      expect(await previewIndex.text()).toContain('Preview build');

      const previewAsset = await fetch(`${origin}/web-preview/assets/preview.js`);
      expect(previewAsset.status).toBe(200);
      expect(previewAsset.headers.get('content-type')).toContain('javascript');
      expect(await previewAsset.text()).toContain('preview');

      const previewDeepLink = await fetch(`${origin}/web-preview/some/deep/path`);
      expect(previewDeepLink.status).toBe(200);
      expect(await previewDeepLink.text()).toContain('Preview build');

      const asset = await fetch(`${origin}/app.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('javascript');

      const fallback = await fetch(`${origin}/some/deep/path`);
      expect(fallback.status).toBe(200);
      expect(await fallback.text()).toContain('Serpent');

      const traversal = await rawGet(origin, '/..%2f..%2fpackage.json');
      expect(traversal.status).toBe(400);
    } finally {
      await staticServer.close();
    }
  });
});
