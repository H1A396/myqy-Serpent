import { describe, expect, it } from 'vitest';

import type { WorkerCommand } from '../../src/shared/protocol/requests';
import { createPublicError } from '../../src/shared/protocol/errors';
import {
  WebShareDataError,
  WorkerBackedWebShareData,
  type WebShareWorkerClient,
} from '../../src/myqy-web-share/server/web-share-data';
import { WorkerBackedWebShareMedia } from '../../src/myqy-web-share/server/web-share-media';

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
          // Library-relative, exactly as the Worker reports it.
          filePath: 'art-1.webp',
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
          entries: command.artifactIds.map((artifactId) => ({
            artifactId,
            absolutePath: artifactId.startsWith('proxy')
              ? `X:/library/.serpent/artifacts/${artifactId}.webm`
              : `X:/library/.serpent/artifacts/${artifactId}.webp`,
          })),
        };
      }
      throw new Error(`unexpected ${command.type}`);
    });
    const media = new WorkerBackedWebShareMedia(client);
    expect(await media.resolveThumbnail({ libraryId: 'lib-a', assetId: 'asset-1' })).toMatchObject({
      absolutePath: 'X:/library/.serpent/artifacts/art-1.webp',
      mimeType: 'image/webp',
    });
    expect(
      await media.resolveSource({ libraryId: 'lib-a', assetId: 'asset-1', revisionId: 'rev-1' }),
    ).toMatchObject({ mimeType: 'video/mp4' });
    expect(
      await media.resolveArtifact({ libraryId: 'lib-a', artifactId: 'proxy-1', kind: 'proxy' }),
    ).toMatchObject({ mimeType: 'video/webm' });
  });

  it('never serves the Worker thumbnail filePath as an absolute path', async () => {
    // Regression: media.get-thumbnail-artifact.filePath is relative to
    // .serpent/artifacts; treating it as absolute made every already-generated
    // thumbnail 404 in the browser (only freshly generated ones rendered).
    const client = new FakeWorkerClient((command) => {
      if (command.type === 'media.get-thumbnail-artifact') {
        return {
          ok: true,
          type: 'media.thumbnail-artifact',
          artifactId: 'existing-1',
          filePath: 'existing-1.webp',
          width: 512,
          height: 512,
        };
      }
      if (command.type === 'media.get-artifact-paths') {
        return {
          ok: true,
          type: 'media.artifact-paths',
          entries: [
            {
              artifactId: 'existing-1',
              absolutePath: 'X:/library/.serpent/artifacts/existing-1.webp',
            },
          ],
        };
      }
      throw new Error(`unexpected ${command.type}`);
    });
    const media = new WorkerBackedWebShareMedia(client);
    const resolved = await media.resolveThumbnail({ libraryId: 'lib-a', assetId: 'asset-1' });
    expect(resolved?.absolutePath).toBe('X:/library/.serpent/artifacts/existing-1.webp');
    expect(resolved?.absolutePath).not.toBe('existing-1.webp');
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

  it('generates a missing thumbnail on demand and resolves its path', async () => {
    const client = new FakeWorkerClient((command) => {
      if (command.type === 'media.get-thumbnail-artifact') {
        return { ok: false, error: createPublicError('ASSET_NOT_FOUND') };
      }
      if (command.type === 'media.generate-thumbnail') {
        return { ok: true, type: 'media.thumbnail.generated', assetId: 'asset-1', artifactId: 'art-new' };
      }
      if (command.type === 'media.get-artifact-paths') {
        return {
          ok: true,
          type: 'media.artifact-paths',
          entries: [{ artifactId: 'art-new', absolutePath: 'X:/library/.serpent/artifacts/new.webp' }],
        };
      }
      throw new Error(`unexpected ${command.type}`);
    });
    const media = new WorkerBackedWebShareMedia(client);
    expect(await media.resolveThumbnail({ libraryId: 'lib-a', assetId: 'asset-1' })).toMatchObject({
      mimeType: 'image/webp',
      absolutePath: 'X:/library/.serpent/artifacts/new.webp',
    });
  });

  it('reports a thumbnail as unavailable when generation yields no artifact', async () => {
    const client = new FakeWorkerClient((command) => {
      if (command.type === 'media.get-thumbnail-artifact') {
        return { ok: false, error: createPublicError('ASSET_NOT_FOUND') };
      }
      if (command.type === 'media.generate-thumbnail') {
        return { ok: true, type: 'media.thumbnail.generated', assetId: 'asset-1' };
      }
      throw new Error(`unexpected ${command.type}`);
    });
    const media = new WorkerBackedWebShareMedia(client);
    expect(await media.resolveThumbnail({ libraryId: 'lib-a', assetId: 'asset-1' })).toBeNull();
  });
});
