import {
  type AssetMetadataResult,
  type AssetSummary,
  type CollectionSummary,
  type ExtractedMetadataResult,
  type FilterClause,
  type FolderBrowseEntry,
  type LinkedFolderSummary,
  type ManagedFolderSummary,
  type SearchQuery,
  type SearchScope,
  type SortDefinition,
  type TagSummary,
} from '../shared/asset-types';
import type { WorkerCommand } from '../shared/protocol/requests';
import { workerResultSchema, type WorkerResult } from '../shared/protocol/responses';
import {
  webShareAssetDetailSchema,
  type WebShareAssetDetail,
  type WebShareLibrarySummary,
  type WebShareSearchResult,
} from '../shared/web-share';

/**
 * Structural Worker surface the web share needs. Kept as an interface so the
 * data provider can be unit-tested with a fake client instead of Electron's
 * UtilityProcess-backed `LibraryWorkerClient`.
 */
export interface WebShareWorkerClient {
  request(command: WorkerCommand): Promise<unknown>;
}

export class WebShareDataError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('The library request could not be completed.');
    this.name = 'WebShareDataError';
    this.code = code;
  }
}

export const WEB_SHARE_DEFAULT_PAGE_SIZE = 100;
export const WEB_SHARE_MAX_PAGE_SIZE = 200;

export interface WebShareAssetQuery {
  libraryId: string;
  query: SearchQuery;
  filters?: FilterClause[];
  scope?: SearchScope;
  sort?: SortDefinition;
  limit?: number;
  offset?: number;
}

export interface WebShareDataProvider {
  listLibraries(): Promise<WebShareLibrarySummary[]>;
  listFolders(libraryId: string): Promise<ManagedFolderSummary[]>;
  listLinkedFolders(libraryId: string): Promise<LinkedFolderSummary[]>;
  browseEntries(libraryId: string, parentFolderId: string | null): Promise<FolderBrowseEntry[]>;
  searchAssets(input: WebShareAssetQuery): Promise<WebShareSearchResult>;
  listAssets(input: {
    libraryId: string;
    folderId: string | null;
    recursive: boolean;
    limit?: number;
    offset?: number;
  }): Promise<WebShareSearchResult>;
  listCollectionAssets(input: {
    libraryId: string;
    collectionId: string;
    recursive: boolean;
    limit?: number;
    offset?: number;
  }): Promise<WebShareSearchResult>;
  getAssetDetail(input: { libraryId: string; assetId: string }): Promise<WebShareAssetDetail>;
  listTags(libraryId: string): Promise<TagSummary[]>;
  listCollections(libraryId: string): Promise<CollectionSummary[]>;
}

function clampPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return WEB_SHARE_DEFAULT_PAGE_SIZE;
  return Math.min(WEB_SHARE_MAX_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Read-only adapter over the Library Worker. Every method issues a query
 * command only; no mutation command is reachable from this module.
 */
export class WorkerBackedWebShareData implements WebShareDataProvider {
  readonly #client: WebShareWorkerClient;

  constructor(client: WebShareWorkerClient) {
    this.#client = client;
  }

  async #request(command: WorkerCommand): Promise<WorkerResult> {
    const raw = await this.#client.request(command);
    return workerResultSchema.parse(raw);
  }

  async listLibraries(): Promise<WebShareLibrarySummary[]> {
    const result = await this.#request({ type: 'library.list' });
    if (!result.ok || result.type !== 'library.list') {
      throw new WebShareDataError('WEB_SHARE_LIBRARIES_UNAVAILABLE');
    }
    return result.libraries.map((library) => ({
      libraryId: library.libraryId,
      displayName: library.displayName,
    }));
  }

  async listFolders(libraryId: string): Promise<ManagedFolderSummary[]> {
    const result = await this.#request({ type: 'folder.list', libraryId });
    if (!result.ok || result.type !== 'folder.list') {
      throw new WebShareDataError('WEB_SHARE_FOLDERS_UNAVAILABLE');
    }
    return result.folders;
  }

  async listLinkedFolders(libraryId: string): Promise<LinkedFolderSummary[]> {
    const result = await this.#request({ type: 'linked-folder.list', libraryId });
    if (!result.ok || result.type !== 'linked-folder.list') {
      throw new WebShareDataError('WEB_SHARE_FOLDERS_UNAVAILABLE');
    }
    return result.folders;
  }

  async browseEntries(
    libraryId: string,
    parentFolderId: string | null,
  ): Promise<FolderBrowseEntry[]> {
    const result = await this.#request({
      type: 'folder.browse-entries',
      libraryId,
      parentFolderId,
    });
    if (!result.ok || result.type !== 'folder.browse-entries') {
      throw new WebShareDataError('WEB_SHARE_FOLDERS_UNAVAILABLE');
    }
    return result.entries;
  }

  async searchAssets(input: WebShareAssetQuery): Promise<WebShareSearchResult> {
    const result = await this.#request({
      type: 'asset.search',
      libraryId: input.libraryId,
      query: input.query,
      ...(input.filters === undefined ? {} : { filters: input.filters }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      limit: clampPageSize(input.limit),
      offset: clampOffset(input.offset),
    });
    if (!result.ok || result.type !== 'asset.search.result') {
      throw new WebShareDataError('WEB_SHARE_SEARCH_FAILED');
    }
    return { items: result.items, total: result.total, offset: result.offset };
  }

  async listAssets(input: {
    libraryId: string;
    folderId: string | null;
    recursive: boolean;
    limit?: number;
    offset?: number;
  }): Promise<WebShareSearchResult> {
    return this.searchAssets({
      libraryId: input.libraryId,
      query: { clauses: [] },
      scope: { kind: 'folder', folderId: input.folderId, recursive: input.recursive },
      limit: input.limit,
      offset: input.offset,
    });
  }

  async listCollectionAssets(input: {
    libraryId: string;
    collectionId: string;
    recursive: boolean;
    limit?: number;
    offset?: number;
  }): Promise<WebShareSearchResult> {
    return this.searchAssets({
      libraryId: input.libraryId,
      query: { clauses: [] },
      scope: {
        kind: 'collection',
        collectionId: input.collectionId,
        recursive: input.recursive,
      },
      limit: input.limit,
      offset: input.offset,
    });
  }

  async getAssetDetail(input: {
    libraryId: string;
    assetId: string;
  }): Promise<WebShareAssetDetail> {
    const asset = await this.#fetchAssetSummary(input.libraryId, input.assetId);
    if (asset === undefined) throw new WebShareDataError('WEB_SHARE_ASSET_NOT_FOUND');
    const [metadata, extracted] = await Promise.all([
      this.#fetchMetadata(input.libraryId, input.assetId),
      this.#fetchExtractedMetadata(input.libraryId, input.assetId),
    ]);
    return webShareAssetDetailSchema.parse({ asset, metadata, extracted });
  }

  async #fetchAssetSummary(libraryId: string, assetId: string): Promise<AssetSummary | undefined> {
    const result = await this.#request({
      type: 'asset.list',
      libraryId,
      recursive: false,
      assetIds: [assetId],
    });
    if (!result.ok || result.type !== 'asset.list') {
      throw new WebShareDataError('WEB_SHARE_ASSET_UNAVAILABLE');
    }
    return result.assets[0];
  }

  async #fetchMetadata(libraryId: string, assetId: string): Promise<AssetMetadataResult> {
    const result = await this.#request({
      type: 'asset.metadata.get',
      libraryId,
      assetId,
    });
    if (!result.ok || result.type !== 'asset.metadata.got') {
      throw new WebShareDataError('WEB_SHARE_ASSET_UNAVAILABLE');
    }
    return result.metadata;
  }

  async #fetchExtractedMetadata(
    libraryId: string,
    assetId: string,
  ): Promise<ExtractedMetadataResult> {
    const result = await this.#request({
      type: 'asset.extracted-metadata.get',
      libraryId,
      assetId,
    });
    if (!result.ok || result.type !== 'asset.extracted-metadata.got') {
      throw new WebShareDataError('WEB_SHARE_ASSET_UNAVAILABLE');
    }
    return result.result;
  }

  async listTags(libraryId: string): Promise<TagSummary[]> {
    const result = await this.#request({ type: 'tag.list', libraryId });
    if (!result.ok || result.type !== 'tag.list') {
      throw new WebShareDataError('WEB_SHARE_TAGS_UNAVAILABLE');
    }
    return result.tags;
  }

  async listCollections(libraryId: string): Promise<CollectionSummary[]> {
    const result = await this.#request({ type: 'collection.list', libraryId });
    if (!result.ok || result.type !== 'collection.list') {
      throw new WebShareDataError('WEB_SHARE_COLLECTIONS_UNAVAILABLE');
    }
    return result.collections;
  }
}
