import type {
  AssetSummary,
  CollectionSummary,
  ManagedFolderSummary,
  TagSummary,
} from '../../shared/asset-types';


export interface WebShareState {
  app: string;
  sharedLibraryId: string | null;
  library: { libraryId: string; displayName: string } | null;
  allowDownload: boolean;
  requiresPassword: boolean;
  username: string | null;
  /** Changes when the operator changes thumbnail settings (cache-busting). */
  thumbnailVersion: string;
}

export interface WebShareConfig {
  app: string;
  requiresPassword: boolean;
  /** The server only sets this for a direct local (loopback) browser. */
  debug: boolean;
}

/** The visitor's own favorite/rating for one asset. */
export interface VisitorMarks {
  favorite: boolean;
  rating: number;
}

export interface SearchResult {
  items: AssetSummary[];
  total: number;
  offset: number;
}

export interface AssetDetail {
  asset: AssetSummary;
  metadata: {
    description: string | null;
    rating: number;
    favorite: boolean;
    sourcePageUrl: string | null;
    author: string | null;
    tags: Array<{ id: string; name: string; source: 'user' | 'ai' }>;
  };
  extracted: {
    assetId: string;
    status: 'ready' | 'pending' | 'failed' | 'missing';
    metadata: Record<string, unknown> | null;
  };
  /** The signed-in visitor's own marks (never the library owner's). */
  marks?: VisitorMarks;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    try {
      const body = (await response.json()) as { code?: unknown };
      if (typeof body.code === 'string') code = body.code;
    } catch {
      // Non-JSON error body; keep the HTTP code.
    }
    throw new ApiError(response.status, code);
  }
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

export interface SearchParams {
  libraryId: string;
  query: string;
  scope:
    | { kind: 'folder'; folderId: string | null; recursive: boolean }
    | { kind: 'collection'; collectionId: string; recursive: boolean };
  sort?: string;
  order?: string;
  tag?: string;
  rating?: string;
  favorite?: string;
  availability?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  config: (): Promise<WebShareConfig> => request('/api/config'),

  state: (): Promise<WebShareState> => request('/api/state'),

  async login(username: string, password?: string): Promise<void> {
    await request('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(password === undefined ? { username } : { username, password }),
    });
  },

  marks: (libraryId: string, assetId: string): Promise<{ marks: VisitorMarks }> =>
    request(
      `/api/libraries/${encodeURIComponent(libraryId)}/assets/${encodeURIComponent(assetId)}/marks`,
    ),

  setMarks: (
    libraryId: string,
    assetId: string,
    patch: { favorite?: boolean; rating?: number },
  ): Promise<{ ok: true; marks: VisitorMarks }> =>
    request(
      `/api/libraries/${encodeURIComponent(libraryId)}/assets/${encodeURIComponent(assetId)}/marks`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    ),

  async logout(): Promise<void> {
    await request('/api/session', { method: 'DELETE' });
  },

  folders: (libraryId: string): Promise<{ folders: ManagedFolderSummary[] }> =>
    request(`/api/libraries/${encodeURIComponent(libraryId)}/folders`),

  collections: (libraryId: string): Promise<{ collections: CollectionSummary[] }> =>
    request(`/api/libraries/${encodeURIComponent(libraryId)}/collections`),

  tags: (libraryId: string): Promise<{ tags: TagSummary[] }> =>
    request(`/api/libraries/${encodeURIComponent(libraryId)}/tags`),

  search: (params: SearchParams): Promise<SearchResult> =>
    request(
      `/api/libraries/${encodeURIComponent(params.libraryId)}/search${query({
        q: params.query,
        scope: params.scope.kind,
        folderId: params.scope.kind === 'folder' ? (params.scope.folderId ?? 'root') : undefined,
        collectionId: params.scope.kind === 'collection' ? params.scope.collectionId : undefined,
        recursive: params.scope.recursive ? '1' : undefined,
        sort: params.sort,
        order: params.order,
        tag: params.tag,
        rating: params.rating,
        favorite: params.favorite,
        availability: params.availability,
        limit: params.limit,
        offset: params.offset,
      })}`,
    ),

  asset: (libraryId: string, assetId: string): Promise<AssetDetail> =>
    request(
      `/api/libraries/${encodeURIComponent(libraryId)}/assets/${encodeURIComponent(assetId)}`,
    ),
};

/**
 * Grid thumbnail. `cacheKey` (asset revision + thumbnail settings) is appended
 * so the bytes change whenever the image or the thumbnail settings change,
 * making a long-lived client/HTTP cache safe.
 */
export function thumbnailUrl(libraryId: string, assetId: string, cacheKey?: string): string {
  const base = `/media/thumbnail/${encodeURIComponent(libraryId)}/${encodeURIComponent(assetId)}`;
  return cacheKey === undefined || cacheKey === '' ? base : `${base}?v=${encodeURIComponent(cacheKey)}`;
}

export function sourceUrl(libraryId: string, asset: AssetSummary): string {
  return `/media/source/${encodeURIComponent(libraryId)}/${encodeURIComponent(asset.assetId)}?revision=${encodeURIComponent(asset.currentRevisionId)}`;
}

export function downloadUrl(libraryId: string, asset: AssetSummary): string {
  return `${sourceUrl(libraryId, asset)}&download=1`;
}

/**
 * Bounded WebP for the viewer, or — with `download` — the full-resolution JPEG
 * the "Download" button saves (the server re-encodes from the original).
 *
 * `tier: 'high'` asks for the second LOD tier (quality 100, same bounding
 * edge). The viewer starts on the default tier and upgrades when zooming in.
 */
export function viewUrl(
  libraryId: string,
  asset: AssetSummary,
  options?: { download?: boolean; tier?: 'low' | 'high' },
): string {
  const query = new URLSearchParams({ revision: asset.currentRevisionId });
  if (options?.download === true) query.set('download', '1');
  if (options?.tier === 'high') query.set('quality', '100');
  return `/media/view/${encodeURIComponent(libraryId)}/${encodeURIComponent(asset.assetId)}?${query.toString()}`;
}
