import { mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteShareDerivativesByQuality,
  evictShareDerivatives,
  listShareDerivativeFiles,
  shareDerivativeFileName,
  shareDerivativeStats,
} from '../../src/worker/web-share-derivative-cache';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function makeCacheDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'serpent-share-derivative-cache-'));
  directories.push(directory);
  return directory;
}

describe('share derivative cache', () => {
  it('names the file after asset, revision, edge and quality', () => {
    expect(shareDerivativeFileName('asset', 'rev', 2560, 82)).toBe('asset.rev.2560.82.webp');
  });

  it('lists only webp cache files', () => {
    const directory = makeCacheDir();
    writeFileSync(path.join(directory, 'asset.rev.2560.82.webp'), Buffer.alloc(10));
    writeFileSync(path.join(directory, 'ignore.txt'), Buffer.from('x'));
    const files = listShareDerivativeFiles(directory);
    expect(files.map((file) => path.basename(file.absolutePath))).toEqual([
      'asset.rev.2560.82.webp',
    ]);
  });

  it('evicts the oldest files until the budget fits', () => {
    const directory = makeCacheDir();
    const oldFile = path.join(directory, 'old.rev.1.1.webp');
    const newerFile = path.join(directory, 'new.rev.1.1.webp');
    writeFileSync(oldFile, Buffer.alloc(100));
    writeFileSync(newerFile, Buffer.alloc(100));
    // Make `oldFile` clearly the least recently modified.
    const past = new Date(Date.now() - 60_000);
    utimesSync(oldFile, past, past);

    const removed = evictShareDerivatives(directory, 0, 150);
    expect(removed).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newerFile)).toBe(true);
  });

  it('removes nothing when the budget already fits', () => {
    const directory = makeCacheDir();
    const file = path.join(directory, 'a.rev.1.1.webp');
    writeFileSync(file, Buffer.alloc(10));
    expect(evictShareDerivatives(directory, 10, 1024)).toBe(0);
    expect(existsSync(file)).toBe(true);
  });

  it('summarizes occupancy per LOD tier and ignores unparsable names', () => {
    const directory = makeCacheDir();
    writeFileSync(path.join(directory, shareDerivativeFileName('a', 'r', 2560, 82)), Buffer.alloc(100));
    writeFileSync(path.join(directory, shareDerivativeFileName('b', 'r', 2560, 82)), Buffer.alloc(50));
    writeFileSync(path.join(directory, shareDerivativeFileName('a', 'r', 2560, 100)), Buffer.alloc(300));
    writeFileSync(path.join(directory, 'noquality.webp'), Buffer.alloc(999));
    const stats = shareDerivativeStats(directory);
    expect(stats).toEqual([
      { quality: 82, fileCount: 2, totalBytes: 150 },
      { quality: 100, fileCount: 1, totalBytes: 300 },
    ]);
  });

  it('deletes only the requested tier', () => {
    const directory = makeCacheDir();
    const q82 = path.join(directory, shareDerivativeFileName('a', 'r', 2560, 82));
    const q100 = path.join(directory, shareDerivativeFileName('a', 'r', 2560, 100));
    writeFileSync(q82, Buffer.alloc(100));
    writeFileSync(q100, Buffer.alloc(300));
    expect(deleteShareDerivativesByQuality(directory, 82)).toBe(1);
    expect(existsSync(q82)).toBe(false);
    expect(existsSync(q100)).toBe(true);
  });
});