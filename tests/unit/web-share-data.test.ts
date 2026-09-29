import { describe, expect, it } from 'vitest';

import type { WorkerCommand } from '../../src/shared/protocol/requests';
import { createPublicError } from '../../src/shared/protocol/errors';
import {
  WebShareDataError,
  WorkerBackedWebShareData,
  type WebShareWorkerClient,
} from '../../src/main/web-share-data';
import { WorkerBackedWebShareMedia } from '../../src/main/web-share-media';

class FakeWorkerClient implements WebShareWorkerClient {
  readonly commands: WorkerCommand[] = [];

  constructor(private readonly respond: (command: WorkerCommand) => unknown) {}

  async request(command: WorkerCommand): Promise<unknown> {
    this.commands.push(command);
    return this.respond(command);
  }
}

function assetSummary(overrides: Record<string, unknown> = {}) {
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
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: 'image',
    width: 10,
    height: 10,
    ...overrides,
  };
}

describe('WorkerBackedWebShareData', () => {
  it('projects libraries to id and display name only', async () => {
    const client = new FakeWorkerClient(() => ({
      ok: true,
      type: 'library.list',
      libraries: [
        {
          libraryId: 'lib-a',
          displayName: 'Library A',
          libraryPath: 'X:/private/library',
        },
      ],
    }));
    const data = new WorkerBackedWebShareData(client);
    const libraries = await data.listLibraries();
    expect(libraries).toEqual([{ libraryId: 'lib-a', displayName: 'Library A' }]);
    expect(JSON.stringify(libraries)).not.toContain('private');
  });

  it('queries assets through a folder-scoped search with a clamped page size', async () => {
    const client = new FakeWorkerClient(() => ({
      ok: true,
      type: 'asset.search.result',
      items: [assetSummary()],
      total: 1,
      offset: 0,
    }));
    const data = new WorkerBackedWebShareData(client);
    const result = await data.listAssets({
      libraryId: 'lib-a',
      folderId: 'folder-1',
      recursive: true,
      limit: 9999,
      offset: 5,
    });
    expect(result.total).toBe(1);
    const command = client.commands[0];
    expect(command).toMatchObject({
      type: 'asset.search',
      libraryId: 'lib-a',
      scope: { kind: 'folder', folderId: 'folder-1', recursive: true },
      limit: 200,
      offset: 5,
    });
  });

  it('assembles read-only asset detail from summary, metadata and extracted data', async () => {
    const client = new FakeWorkerClient((command) => {
      if (command.type === 'asset.list') {
        return { ok: true, type: 'asset.list', assets: [assetSummary()] };
      }
      if (command.type === 'asset.metadata.get') {
        return {
          ok: true,
          type: 'asset.metadata.got',
          metadata: {
            assetId: 'asset-1',
            description: null,
            rating: 3,
            favorite: true,
            palette: null,
            automaticPalette: [],
            effectivePalette: [],
            paletteSource: null,
            sourcePageUrl: null,
            author: null,
            tags: [],
            entityVersion: 1,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        };
      }
      if (command.type === 'asset.extracted-metadata.get') {
        return {
          ok: true,
          type: 'asset.extracted-metadata.got',
          result: { assetId: 'asset-1', status: 'missing', metadata: null },
        };
      }
      throw new Error(`unexpected ${command.type}`);
    });
    const data = new WorkerBackedWebShareData(client);
    const detail = await data.getAssetDetail({ libraryId: 'lib-a', assetId: 'asset-1' });
    expect(detail.asset.assetId).toBe('asset-1');
    expect(detail.metadata.rating).toBe(3);
    expect(detail.extracted.status).toBe('missing');
  });

  it('fails closed when the Worker reports an error', async () => {
    const client = new FakeWorkerClient(() => ({
      ok: false,
      error: createPublicError('ASSET_NOT_FOUND'),
    }));
    const data = new WorkerBackedWebShareData(client);
    await expect(data.listTags('lib-a')).rejects.toBeInstanceOf(WebShareDataError);
  });
});

describe('WorkerBackedWebShareMedia', () => {
  it('resolves thumbnail, source and artifact paths', async () => {
    const client = new FakeWorkerClient((command) => {
      if (command.type === 'media.get-thumbnail-artifact') {
        return {
          ok: true,
          type: 'media.thumbnail-artifact',
          artifactId: 'art-1',
          filePath: 'X:/library/.serpent/artifacts/thumb.webp',
          width: 10,
          height: 10,
        };
      }
      if (command.type === 'media.get-source-path') {
        return {
          ok: true,
          type: 'media.source-path',
          assetId: 'asset-1',
          revisionId: 'rev-1',
          absolutePath: 'X:/library/Assets/clip.mp4',
          mimeType: 'video/mp4',
        };
      }
      if (command.type === 'media.get-artifact-paths') {
        return {
          ok: true,
          type: 'media.artifact-paths',
          entries: [{ artifactId: 'proxy-1', absolutePath: 'X:/library/.serpent/artifacts/proxy.webm' }],
        };
      }
      throw new Error(`unexpected ${command.type}`);
    });
    const media = new WorkerBackedWebShareMedia(client);
    expect(await media.resolveThumbnail({ libraryId: 'lib-a', assetId: 'asset-1' })).toMatchObject({
      mimeType: 'image/webp',
    });
    expect(
      await media.resolveSource({ libraryId: 'lib-a', assetId: 'asset-1', revisionId: 'rev-1' }),
    ).toMatchObject({ mimeType: 'video/mp4' });
    expect(
      await media.resolveArtifact({ libraryId: 'lib-a', artifactId: 'proxy-1', kind: 'proxy' }),
    ).toMatchObject({ mimeType: 'video/webm' });
  });

  it('returns null when an artifact is absent', async () => {
    const client = new FakeWorkerClient(() => ({
      ok: true,
      type: 'media.artifact-paths',
      entries: [],
    }));
    const media = new WorkerBackedWebShareMedia(client);
    expect(
      await media.resolveArtifact({ libraryId: 'lib-a', artifactId: 'missing', kind: 'preview' }),
    ).toBeNull();
  });
});
