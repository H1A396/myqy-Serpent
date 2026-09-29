import type {
  AssetSummary,
  CollectionSummary,
  ManagedFolderSummary,
  TagSummary,
} from '../shared/asset-types';

export interface WebShareState {
  app: string;
  sharedLibraryId: string | null;
  library: { libraryId: string; displayName: string } | null;
  allowDownload: boolean;
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
  state: (): Promise<WebShareState> => request('/api/state'),

  async login(password: string): Promise<void> {
    await request('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  },

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

export function thumbnailUrl(libraryId: string, assetId: string): string {
  return `/media/thumbnail/${encodeURIComponent(libraryId)}/${encodeURIComponent(assetId)}`;
}

export function sourceUrl(libraryId: string, asset: AssetSummary): string {
  return `/media/source/${encodeURIComponent(libraryId)}/${encodeURIComponent(asset.assetId)}?revision=${encodeURIComponent(asset.currentRevisionId)}`;
}

export function downloadUrl(libraryId: string, asset: AssetSummary): string {
  return `${sourceUrl(libraryId, asset)}&download=1`;
}
