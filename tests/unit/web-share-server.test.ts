import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
import type {
  WebShareAssetQuery,
  WebShareDataProvider,
} from '../../src/main/web-share-data';
import { WebShareServer } from '../../src/main/web-share-server';
import type { ResolvedMedia, WebShareMediaResolver } from '../../src/main/web-share-media';
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

  async getAssetDetail(): Promise<{
    asset: AssetSummary;
    metadata: AssetMetadataResult;
    extracted: ExtractedMetadataResult;
  }> {
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
  let baseUrl: string;
  let mediaPaths: Record<string, string>;

  beforeEach(async () => {
    userDataPath = await mkdtemp(path.join(os.tmpdir(), 'serpent-web-share-'));
    mediaPaths = {
      'thumbnail:asset-1': path.join(userDataPath, 'thumb.webp'),
      'source:asset-1': path.join(userDataPath, 'clip.mp4'),
      'preview:art-1': path.join(userDataPath, 'preview.webm'),
    };
    await writeFile(mediaPaths['thumbnail:asset-1']!, Buffer.from('thumb-bytes'));
    await writeFile(mediaPaths['source:asset-1']!, Buffer.from('0123456789'));
    await writeFile(mediaPaths['preview:art-1']!, Buffer.from('preview-bytes'));
    provider = new FakeDataProvider([
      { libraryId: 'lib-a', displayName: 'Library A' },
      { libraryId: 'lib-b', displayName: 'Library B' },
    ]);
    server = new WebShareServer({
      userDataPath,
      data: provider,
      media: new FakeMediaResolver(mediaPaths),
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

  async function login(password: string): Promise<{ status: number; cookie?: string }> {
    const response = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
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

  it('rejects API access before a password is configured', async () => {
    const response = await fetch(`${baseUrl}/api/state`);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('WEB_SHARE_PASSWORD_REQUIRED');
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

  it('serves a thumbnail for the shared library', async () => {
    server.setPassword('correct horse battery');
    const { cookie } = await login('correct horse battery');
    const response = await fetch(`${baseUrl}/media/thumbnail/lib-a/asset-1`, {
      headers: { Cookie: cookie! },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
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
