import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LibraryService } from '../../src/worker/library-service';
import { createShareDerivative } from '../../src/worker/web-share-derivative';

// The Worker loads Sharp lazily through a CommonJS require; mirror that so the
// test exercises the real encoder instead of a stub.
interface TestSharpPipeline {
  png(): TestSharpPipeline;
  toFile(filePath: string): Promise<unknown>;
}
interface TestSharp {
  (input: string): TestSharpPipeline;
  (input: {
    create: {
      width: number;
      height: number;
      channels: number;
      background: { r: number; g: number; b: number; alpha: number };
    };
  }): TestSharpPipeline;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as TestSharp;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** Real 64×64 PNG whose absolute path stands in for a library source. */
async function writeSourceImage(): Promise<{ directory: string; filePath: string }> {
  const directory = mkdtempSync(path.join(tmpdir(), 'serpent-share-derivative-test-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'source.png');
  await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } },
  })
    .png()
    .toFile(filePath);
  return { directory, filePath };
}

function libraryServiceReturning(filePath: string): LibraryService {
  return {
    getCurrentMediaSource: () => ({ absolutePath: filePath, mimeType: 'image/png' }),
  } as unknown as LibraryService;
}

describe('createShareDerivative', () => {
  it('encodes the requested format into a temporary file', async () => {
    const { filePath } = await writeSourceImage();
    const result = await createShareDerivative({
      libraryService: libraryServiceReturning(filePath),
      sharpFactory: sharp as never,
      request: {
        libraryId: 'lib-a',
        assetId: 'asset-1',
        revisionId: 'rev-1',
        format: 'jpeg',
        maxEdge: 32,
        quality: 80,
      },
    });

    // Written outside the library, into the OS temporary directory.
    expect(result.absolutePath.startsWith(tmpdir())).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.byteSize).toBeGreaterThan(0);
    // Bounded by `maxEdge`, not the 64px source.
    expect(Math.max(result.width, result.height)).toBe(32);
    expect(existsSync(result.absolutePath)).toBe(true);

    result.cleanup();
    expect(existsSync(result.absolutePath)).toBe(false);
    // Idempotent: the response 'close' handler may run after a manual cleanup.
    expect(() => result.cleanup()).not.toThrow();
  });

  it('never enlarges a source smaller than the bound', async () => {
    const { filePath } = await writeSourceImage();
    const result = await createShareDerivative({
      libraryService: libraryServiceReturning(filePath),
      sharpFactory: sharp as never,
      request: {
        libraryId: 'lib-a',
        assetId: 'asset-1',
        revisionId: 'rev-1',
        format: 'webp',
        maxEdge: 2560,
        quality: 82,
      },
    });
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    result.cleanup();
  });

  it('leaves no temporary directory behind when encoding fails', async () => {
    const { directory } = await writeSourceImage();
    const failing = ((): never => {
      throw new Error('decode failed');
    }) as never;

    await expect(
      createShareDerivative({
        libraryService: libraryServiceReturning(path.join(directory, 'missing.png')),
        sharpFactory: failing,
        request: {
          libraryId: 'lib-a',
          assetId: 'asset-1',
          revisionId: 'rev-1',
          format: 'png',
          maxEdge: 512,
          quality: 82,
        },
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
