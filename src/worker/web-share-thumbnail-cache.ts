import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Share-only grid thumbnail cache.
 *
 * The read-only web share renders tiles far smaller than the desktop's 512px
 * card, so it keeps its own downscaled copies under
 * `<library>/.serpent/share-thumbnails/<edge>/`. That directory sits *beside*
 * `artifacts/`, so the desktop never reads it and the artifact orphan sweep
 * (which only enumerates `artifacts/`) never deletes it. Files are named
 * `<assetId>.<revisionId>.<edge>.<sh>.<kb>kb.webp`, so a superseded revision or
 * a changed byte budget simply falls out of use and is pruned on the next sweep.
 */
export interface ShareThumbnailSharpInstance {
  rotate(): ShareThumbnailSharpInstance;
  toColourspace(colourspace: string): ShareThumbnailSharpInstance;
  resize(options: {
    width: number;
    height: number;
    fit: 'inside';
    withoutEnlargement: boolean;
    kernel: string;
  }): ShareThumbnailSharpInstance;
  sharpen(options: { sigma: number }): ShareThumbnailSharpInstance;
  webp(options: { quality: number; effort: number }): ShareThumbnailSharpInstance;
  toFile(filePath: string): Promise<{ width?: number; height?: number } | unknown>;
}

export type ShareThumbnailSharpFactory = (input: string) => ShareThumbnailSharpInstance;

/** Mild unsharp mask; off by default because it halos edge-dense art. */
export const SHARE_THUMBNAIL_SHARPEN_SIGMA = 0.8;

/**
 * Quality ladder for the adaptive byte budget. The first (highest) quality that
 * fits is kept, so a tile is only re-encoded when it exceeds the budget.
 */
export const SHARE_THUMBNAIL_QUALITY_LADDER = [92, 88, 84, 80, 74, 68, 60, 52] as const;

export function shareThumbnailFileName(
  assetId: string,
  revisionId: string,
  edge: number,
  sharpen: boolean,
  maxKb: number,
): string {
  return `${assetId}.${revisionId}.${edge}.${sharpen ? 'sh1' : 'sh0'}.${maxKb}kb.webp`;
}

export interface EncodedShareThumbnail {
  byteSize: number;
  width: number;
  height: number;
  quality: number;
}

/** Encode one bounded WebP tile at the best quality that fits `maxBytes`. */
export async function encodeShareThumbnail(options: {
  sourceAbsolutePath: string;
  destinationPath: string;
  edge: number;
  sharpen: boolean;
  maxBytes: number;
  sharpFactory: ShareThumbnailSharpFactory;
}): Promise<EncodedShareThumbnail> {
  const { sourceAbsolutePath, destinationPath, edge, sharpen, maxBytes, sharpFactory } = options;
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.${process.pid}.tmp`;
  try {
    let result: EncodedShareThumbnail | null = null;
    for (const quality of SHARE_THUMBNAIL_QUALITY_LADDER) {
      let pipeline = sharpFactory(sourceAbsolutePath)
        .rotate()
        .toColourspace('srgb')
        .resize({
          width: edge,
          height: edge,
          fit: 'inside',
          withoutEnlargement: true,
          // Lanczos3 is the sharpest common kernel.
          kernel: 'lanczos3',
        });
      if (sharpen) pipeline = pipeline.sharpen({ sigma: SHARE_THUMBNAIL_SHARPEN_SIGMA });
      const output = (await pipeline.webp({ quality, effort: 4 }).toFile(temporaryPath)) as {
        width?: number;
        height?: number;
      } | null;
      const byteSize = statSync(temporaryPath).size;
      result = {
        byteSize,
        width: typeof output?.width === 'number' ? output.width : edge,
        height: typeof output?.height === 'number' ? output.height : edge,
        quality,
      };
      if (byteSize <= maxBytes) break;
    }
    if (result === null) throw new Error('No thumbnail candidate was produced.');
    renameSync(temporaryPath, destinationPath);
    return result;
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the encoding error.
    }
    throw error;
  }
}
