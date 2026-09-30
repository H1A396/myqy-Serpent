/**
 * Viewer image loader: pulls the bounded WebP as several parallel byte-range
 * chunks and reassembles it client-side.
 *
 * A single tunnel connection to a far relay tops out at roughly 100–130 KB/s
 * (measured), so a multi-megapixel viewer image takes many seconds. The same
 * bytes split across four connections finish in a fraction of the time, because
 * the per-connection throughput — not the node's total cap — is the bottleneck.
 *
 * The server exposes fixed `chunk=0..N-1` slices of one persisted WebP. Each
 * slice is an exact, contiguous, non-overlapping byte range, so concatenating
 * them in order reproduces the original file. A failed chunk is retried; if the
 * server ignores the parameter (200 instead of 206) or a chunk keeps failing,
 * the loader falls back to one whole-file request.
 */
export const VIEWER_IMAGE_CHUNKS = 4;

const CHUNK_RETRIES = 2;

/** How many reassembled images to keep in memory for instant re-opens. */
const DEFAULT_CACHE_LIMIT = 12;

export class ViewerImageCache {
  readonly #entries = new Map<string, string>();
  readonly #limit: number;

  constructor(limit: number = DEFAULT_CACHE_LIMIT) {
    this.#limit = limit;
  }

  get(key: string): string | undefined {
    const url = this.#entries.get(key);
    if (url === undefined) return undefined;
    // Refresh recency so the image on screen is never the first evicted.
    this.#entries.delete(key);
    this.#entries.set(key, url);
    return url;
  }

  set(key: string, objectUrl: string): void {
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      if (existing !== objectUrl) URL.revokeObjectURL(existing);
      this.#entries.delete(key);
    }
    this.#entries.set(key, objectUrl);
    while (this.#entries.size > this.#limit) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldestUrl = this.#entries.get(oldestKey);
      this.#entries.delete(oldestKey);
      if (oldestUrl !== undefined) URL.revokeObjectURL(oldestUrl);
    }
  }

  clear(): void {
    for (const url of this.#entries.values()) URL.revokeObjectURL(url);
    this.#entries.clear();
  }
}

export const viewerImageCache = new ViewerImageCache();

type Part =
  | { kind: 'chunk'; index: number; buffer: ArrayBuffer }
  | { kind: 'whole'; buffer: ArrayBuffer };

function chunkUrl(url: string, index: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}chunk=${index}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : typeof error === 'object'
      && error !== null
      && (error as { name?: unknown }).name === 'AbortError';
}

async function fetchPart(
  fetchImpl: typeof fetch,
  url: string,
  index: number,
  signal: AbortSignal | undefined,
): Promise<Part> {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt += 1) {
    const response = await fetchImpl(chunkUrl(url, index), { signal });
    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }
    const buffer = await response.arrayBuffer();
    // 200 means the server returned the whole file despite the chunk request.
    return response.status === 206 ? { kind: 'chunk', index, buffer } : { kind: 'whole', buffer };
  }
  throw new Error(`viewer chunk ${index} failed (${lastStatus})`);
}

async function fetchWhole(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`viewer image failed (${response.status})`);
  return response.blob();
}

export async function loadViewerImage(options: {
  url: string;
  key: string;
  cache: ViewerImageCache;
  signal?: AbortSignal;
  chunkCount?: number;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const cached = options.cache.get(options.key);
  if (cached !== undefined) return cached;

  const fetchImpl = options.fetchImpl ?? fetch;
  const chunkCount = Math.max(1, options.chunkCount ?? VIEWER_IMAGE_CHUNKS);

  let blob: Blob;
  try {
    const parts = await Promise.all(
      Array.from({ length: chunkCount }, (_, index) =>
        fetchPart(fetchImpl, options.url, index, options.signal),
      ),
    );
    const whole = parts.find((part): part is { kind: 'whole'; buffer: ArrayBuffer } =>
      part.kind === 'whole',
    );
    if (whole !== undefined) {
      blob = new Blob([whole.buffer], { type: 'image/webp' });
    } else {
      const ordered = parts
        .filter((part): part is { kind: 'chunk'; index: number; buffer: ArrayBuffer } =>
          part.kind === 'chunk',
        )
        .sort((a, b) => a.index - b.index)
        .map((part) => part.buffer);
      blob = new Blob(ordered, { type: 'image/webp' });
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    // The parallel path failed: fall back to a single whole-file request.
    blob = await fetchWhole(fetchImpl, options.url, options.signal);
  }

  const objectUrl = URL.createObjectURL(blob);
  options.cache.set(options.key, objectUrl);
  return objectUrl;
}