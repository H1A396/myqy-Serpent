import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Share-only viewer-derivative cache.
 *
 * The read-only web share viewer shows a bounded WebP re-encode of the
 * original, in two LOD tiers (quality 82 and 100, same bounding edge). Encoding
 * is expensive, so the file is persisted under
 * `<library>/.serpent/share-derivatives/` (beside the `share-thumbnails/` cache)
 * and named `<assetId>.<revisionId>.<edge>.<quality>.webp`, so a superseded
 * revision or a changed encoding setting simply falls out of use and is pruned
 * by the sweep. The settings page sizes each tier from this directory and can
 * pre-generate or delete one tier.
 *
 * Growth is bounded by `SHARE_DERIVATIVE_CACHE_MAX_BYTES`: the worker evicts
 * least-recently-modified files when a new encode would push the directory past
 * the budget. The user chose this trade-off deliberately (persisted big images
 * are the point), the cache just must not grow without limit.
 */
export interface ShareDerivativeCacheDirInfo {
  absolutePath: string;
  byteSize: number;
  mtimeMs: number;
  /** Quality parsed from the file name, or `null` when it does not parse. */
  quality: number | null;
}

/** LOD qualities the cache stores; must match the shared tier constants. */
export const SHARE_DERIVATIVE_QUALITIES = [82, 100] as const;
export type ShareDerivativeQuality = (typeof SHARE_DERIVATIVE_QUALITIES)[number];

export function shareDerivativeFileName(
  assetId: string,
  revisionId: string,
  maxEdge: number,
  quality: number,
): string {
  return `${assetId}.${revisionId}.${maxEdge}.${quality}.webp`;
}

/** `<assetId>.<revisionId>.<edge>.<quality>.webp`; ids never contain dots. */
function qualityFromFileName(name: string): number | null {
  const parts = name.split('.');
  if (parts.length < 5) return null;
  const quality = Number.parseInt(parts[parts.length - 2]!, 10);
  return Number.isInteger(quality) ? quality : null;
}

/** Keep at most 1 GiB of cached viewer derivatives per library. */
export const SHARE_DERIVATIVE_CACHE_MAX_BYTES = 1024 * 1024 * 1024;

export function listShareDerivativeFiles(root: string): ShareDerivativeCacheDirInfo[] {
  if (!existsSync(root)) return [];
  const entries: ShareDerivativeCacheDirInfo[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.webp')) continue;
    const absolutePath = path.join(root, entry.name);
    try {
      const stat = statSync(absolutePath);
      entries.push({
        absolutePath,
        byteSize: stat.size,
        mtimeMs: stat.mtimeMs,
        quality: qualityFromFileName(entry.name),
      });
    } catch {
      // A file removed between readdir and stat; the next sweep retries.
    }
  }
  return entries;
}

/** Occupancy of each cached LOD tier: file count and total bytes on disk. */
export function shareDerivativeStats(
  root: string,
): Array<{ quality: ShareDerivativeQuality; fileCount: number; totalBytes: number }> {
  const byQuality = new Map<number, { fileCount: number; totalBytes: number }>();
  for (const quality of SHARE_DERIVATIVE_QUALITIES) {
    byQuality.set(quality, { fileCount: 0, totalBytes: 0 });
  }
  for (const file of listShareDerivativeFiles(root)) {
    if (file.quality === null) continue;
    const bucket = byQuality.get(file.quality) ?? { fileCount: 0, totalBytes: 0 };
    bucket.fileCount += 1;
    bucket.totalBytes += file.byteSize;
    byQuality.set(file.quality, bucket);
  }
  return SHARE_DERIVATIVE_QUALITIES.map((quality) => ({
    quality,
    ...(byQuality.get(quality) ?? { fileCount: 0, totalBytes: 0 }),
  }));
}

/** Delete every cached derivative of one LOD tier. Returns the file count. */
export function deleteShareDerivativesByQuality(root: string, quality: number): number {
  let removed = 0;
  for (const file of listShareDerivativeFiles(root)) {
    if (file.quality !== quality) continue;
    try {
      rmSync(file.absolutePath, { force: true });
      removed += 1;
    } catch {
      // Best effort; the next sweep retries.
    }
  }
  return removed;
}

/**
 * Evict the least-recently-modified cache files until the directory fits the
 * budget. The bytes of a fresh encode are only part of the story, so the check
 * runs *before* the new file is written and reserves its expected size.
 */
export function evictShareDerivatives(
  root: string,
  incomingBytes: number,
  maxBytes: number = SHARE_DERIVATIVE_CACHE_MAX_BYTES,
): number {
  const entries = listShareDerivativeFiles(root)
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .reverse();
  let total = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
  let removed = 0;
  // Oldest first while still over the budget including the incoming file.
  while (entries.length > 0 && total + incomingBytes > maxBytes) {
    const oldest = entries.pop();
    if (oldest === undefined) break;
    try {
      rmSync(oldest.absolutePath, { force: true });
      total -= oldest.byteSize;
      removed += 1;
    } catch {
      // Best effort; the next write retries.
    }
  }
  return removed;
}