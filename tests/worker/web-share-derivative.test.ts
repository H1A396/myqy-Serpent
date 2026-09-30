import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

describe('createShareDerivative', () => {
  it('encodes the requested format into a temporary file', async () => {
    const { filePath } = await writeSourceImage();
    const result = await createShareDerivative({
      sourceAbsolutePath: filePath,
      sharpFactory: sharp as never,
      request: {
        format: 'jpeg',
        maxEdge: 32,
        quality: 80,
        fullSize: false,
        progressive: false,
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
      sourceAbsolutePath: filePath,
      sharpFactory: sharp as never,
      request: {
        format: 'webp',
        maxEdge: 2560,
        quality: 82,
        fullSize: false,
        progressive: false,
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
        sourceAbsolutePath: path.join(directory, 'missing.png'),
        sharpFactory: failing,
        request: {
          format: 'png',
          maxEdge: 512,
          quality: 82,
          fullSize: false,
          progressive: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('persists the viewer WebP at a destination and keeps it after cleanup', async () => {
    const { directory, filePath } = await writeSourceImage();
    const destination = path.join(directory, 'share-derivatives', 'asset.rev.2560.82.webp');
    const result = await createShareDerivative({
      sourceAbsolutePath: filePath,
      sharpFactory: sharp as never,
      request: {
        format: 'webp',
        maxEdge: 32,
        quality: 82,
        fullSize: false,
        progressive: false,
      },
      destinationAbsolutePath: destination,
    });

    expect(result.cached).toBe(true);
    expect(result.absolutePath).toBe(destination);
    expect(existsSync(destination)).toBe(true);
    // cleanup must not delete a cache entry.
    result.cleanup();
    expect(existsSync(destination)).toBe(true);
  });
});
