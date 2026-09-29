import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LibraryServiceError } from './library-service';

/**
 * Bounded image derivative for the read-only web share.
 *
 * A library that holds ComfyUI output frequently contains 10–30 MB PNGs. A
 * visitor behind a slow tunnel cannot pull those, so the share viewer asks for
 * a re-encoded copy instead: the Worker produces it here, Main streams it, and
 * Main deletes it. Three deliberate properties:
 *
 * - **The caller supplies the source.** The viewer derives from the original
 *   revision (resolved and re-validated by the handler, so a stale share link
 *   cannot encode a superseded revision); the grid derives from the cached card
 *   thumbnail instead of re-decoding a multi-megapixel original per tile.
 * - **Nothing lands in the library.** The output goes to the OS temporary
 *   directory, never `.serpent/artifacts`. Files written there without a
 *   `revision_artifacts` row are deleted by the orphan scan five minutes later,
 *   so they cannot serve as a cache; not claiming to be one keeps the library
 *   schema and its cleanup invariants untouched.
 * - **The caller deletes the file.** `createShareDerivative` returns a path and
 *   a cleanup function. The temporary directory is removed as soon as the
 *   response has been written, including on error.
 */

export type ShareDerivativeFormat = 'webp' | 'jpeg' | 'png';

export interface ShareDerivativeResult {
  absolutePath: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  /** Idempotent; safe to call after a failed transfer. */
  cleanup: () => void;
}

export interface ShareDerivativeRequest {
  format: ShareDerivativeFormat;
  maxEdge: number;
  quality: number;
  /** Keep the original resolution (the "Download" JPEG re-encode). */
  fullSize: boolean;
  /** Progressive/continuous JPEG encoding. */
  progressive: boolean;
}

interface EncodedDerivative {
  /** Longest edge after `rotate()` and `resize()`, i.e. the visible size. */
  width: number;
  height: number;
}

/** A minimal slice of the Sharp API; the Worker loads it lazily elsewhere. */
interface DerivativeSharpInstance {
  rotate(): DerivativeSharpInstance;
  resize(options: {
    width: number;
    height: number;
    fit: 'inside';
    withoutEnlargement: boolean;
  }): DerivativeSharpInstance;
  webp(options: { quality: number; effort?: number }): DerivativeSharpInstance;
  jpeg(options?: {
    quality?: number;
    progressive?: boolean;
    chromaSubsampling?: string;
    optimizeCoding?: boolean;
  }): DerivativeSharpInstance;
  png?(options?: { quality?: number }): DerivativeSharpInstance;
  toFile(filePath: string): Promise<unknown>;
}

type DerivativeSharpFactory = (input: string) => DerivativeSharpInstance;

const MIME_BY_FORMAT: Record<ShareDerivativeFormat, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const EXTENSION_BY_FORMAT: Record<ShareDerivativeFormat, string> = {
  webp: 'webp',
  jpeg: 'jpg',
  png: 'png',
};

function encode(
  pipeline: DerivativeSharpInstance,
  request: ShareDerivativeRequest,
): DerivativeSharpInstance {
  if (request.format === 'webp') return pipeline.webp({ quality: request.quality });
  // JPEG has no alpha; the source is composited over white so a transparent
  // PNG does not turn black in the derivative. 4:4:4 keeps coloured edges crisp
  // (matches a Photoshop quality-10 save); progressive is opt-in.
  if (request.format === 'jpeg') {
    return pipeline.jpeg({
      quality: request.quality,
      progressive: request.progressive,
      chromaSubsampling: '4:4:4',
      optimizeCoding: true,
    });
  }
  // PNG is lossless: `quality` cannot bound its size, so only the resize does.
  if (pipeline.png === undefined) {
    throw new Error('This Sharp build cannot encode PNG derivatives.');
  }
  return pipeline.png({ quality: request.quality });
}

/**
 * Encode one bounded derivative into a temporary file.
 *
 * The caller owns the returned `cleanup` and must run it once the response has
 * been streamed (or failed).
 */
export async function createShareDerivative(options: {
  /** Absolute path of the pixels to encode; the caller owns path validation. */
  sourceAbsolutePath: string;
  sharpFactory: DerivativeSharpFactory;
  request: ShareDerivativeRequest;
}): Promise<ShareDerivativeResult> {
  const { sourceAbsolutePath, sharpFactory, request } = options;

  const stageDir = mkdtempSync(path.join(tmpdir(), 'serpent-share-derivative-'));
  const outputPath = path.join(stageDir, `derivative.${EXTENSION_BY_FORMAT[request.format]}`);
  const cleanup = (): void => {
    rmSync(stageDir, { force: true, recursive: true });
  };

  let encoded: EncodedDerivative;
  try {
    // Honour EXIF orientation first so the derivative matches the source view.
    const rotated = sharpFactory(sourceAbsolutePath).rotate();
    const pipeline = request.fullSize
      ? rotated
      : rotated.resize({
          width: request.maxEdge,
          height: request.maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        });
    const output = await encode(pipeline, request).toFile(outputPath);
    const dimensions = output as { width?: unknown; height?: unknown } | null;
    if (
      dimensions === null
      || typeof dimensions.width !== 'number'
      || typeof dimensions.height !== 'number'
    ) {
      throw new Error('The encoded derivative has no readable dimensions.');
    }
    encoded = { width: dimensions.width, height: dimensions.height };
  } catch (error) {
    cleanup();
    throw new LibraryServiceError('INTERNAL_ERROR', {
      reason: 'MEDIA_PROCESSING_FAILED',
      cause: error,
    });
  }

  let byteSize: number;
  try {
    byteSize = statSync(outputPath).size;
    if (byteSize <= 0) throw new Error('empty output');
  } catch (error) {
    cleanup();
    throw new LibraryServiceError('INTERNAL_ERROR', {
      reason: 'MEDIA_PROCESSING_FAILED',
      cause: error,
    });
  }

  return {
    absolutePath: outputPath,
    mimeType: MIME_BY_FORMAT[request.format],
    byteSize,
    width: encoded.width,
    height: encoded.height,
    cleanup,
  };
}
