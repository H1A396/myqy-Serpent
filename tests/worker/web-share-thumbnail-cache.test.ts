import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  encodeShareThumbnail,
  shareThumbnailFileName,
} from '../../src/worker/web-share-thumbnail-cache';

// The Worker loads Sharp lazily through a CommonJS require; mirror that so the
// test exercises the real encoder instead of a stub.
interface TestSharpPipeline {
  png(): TestSharpPipeline;
  toFile(filePath: string): Promise<unknown>;
}
interface TestSharp {
  (input: string): unknown;
  (input: {
    create: {
      width: number;
      height: number;
      channels: number;
      background: { r: number; g: number; b: number };
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

function makeTempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'serpent-share-thumb-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** Real 512×512 PNG standing in for the library's card artifact. */
async function writeCardArtifact(): Promise<string> {
  const filePath = path.join(makeTempDirectory(), 'card.png');
  await sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .png()
    .toFile(filePath);
  return filePath;
}

describe('share thumbnail cache', () => {
  it('names files by asset, revision, edge, sharpen flag and byte budget', () => {
    expect(shareThumbnailFileName('a1', 'rev1', 128, true, 20)).toBe('a1.rev1.128.sh1.20kb.webp');
    expect(shareThumbnailFileName('a1', 'rev1', 256, false, 40)).toBe('a1.rev1.256.sh0.40kb.webp');
  });

  it('encodes a bounded webp tile at the destination', async () => {
    const source = await writeCardArtifact();
    const destination = path.join(makeTempDirectory(), '128', 'out.webp');
    const result = await encodeShareThumbnail({
      sourceAbsolutePath: source,
      destinationPath: destination,
      edge: 128,
      sharpen: true,
      maxBytes: 20 * 1024,
      sharpFactory: sharp as never,
    });
    expect(existsSync(destination)).toBe(true);
    expect(result.byteSize).toBe(statSync(destination).size);
    // Bounded by `edge`, and never enlarged.
    expect(Math.max(result.width, result.height)).toBe(128);
  });

  it('leaves no temporary file behind when encoding fails', async () => {
    const destination = path.join(makeTempDirectory(), '128', 'out.webp');
    const failing = ((): never => {
      throw new Error('decode failed');
    }) as never;
    await expect(
      encodeShareThumbnail({
        sourceAbsolutePath: 'missing.png',
        destinationPath: destination,
        edge: 128,
        sharpen: false,
        maxBytes: 20 * 1024,
        sharpFactory: failing,
      }),
    ).rejects.toThrow();
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(`${destination}.${process.pid}.tmp`)).toBe(false);
  });
});
