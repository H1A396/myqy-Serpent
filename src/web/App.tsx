import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AssetSummary, CollectionSummary, ManagedFolderSummary, TagSummary } from '../shared/asset-types';
import {
  api,
  ApiError,
  thumbnailUrl,
  sourceUrl,
  type AssetDetail,
  type WebShareState,
} from './api';
import { DetailPanel } from './DetailPanel';
import { formatBytes } from './format';
import { t } from './i18n';
import { Viewer } from './Viewer';

const PAGE_SIZE = 100;

type Scope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'collection'; collectionId: string };

function folderDepth(
  folder: ManagedFolderSummary,
  byId: Map<string, ManagedFolderSummary>,
): number {
  let depth = 0;
  let current = folder.parentFolderId;
  while (current !== null && depth < 16) {
    const parent = byId.get(current);
    if (parent === undefined) break;
    depth += 1;
    current = parent.parentFolderId;
  }
  return depth;
}

function scopeLabel(
  scope: Scope,
  folders: ManagedFolderSummary[],
  collections: CollectionSummary[],
  libraryName: string,
): string {
  if (scope.kind === 'all') return libraryName;
  if (scope.kind === 'folder') {
    return folders.find((folder) => folder.folderId === scope.folderId)?.name ?? libraryName;
  }
  return collections.find((collection) => collection.collectionId === scope.collectionId)?.name ?? libraryName;
}

export function App() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready'>('loading');
  const [state, setState] = useState<WebShareState | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [folders, setFolders] = useState<ManagedFolderSummary[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);

  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [order, setOrder] = useState('asc');
  const [tagFilter, setTagFilter] = useState('');
  const [favorite, setFavorite] = useState('any');
  const [rating, setRating] = useState('');
  const [recursive, setRecursive] = useState(true);

  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const requestIdRef = useRef(0);

  const libraryId = state?.sharedLibraryId ?? null;

  // Bootstrap: probe the session, then load navigation data.
  useEffect(() => {
    void (async () => {
      try {
        const next = await api.state();
        setState(next);
        setPhase('ready');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setPhase('login');
        else setPhase('login');
      }
    })();
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || libraryId === null) return;
    void (async () => {
      try {
        const [folderResult, collectionResult, tagResult] = await Promise.all([
          api.folders(libraryId),
          api.collections(libraryId),
          api.tags(libraryId),
        ]);
        setFolders(folderResult.folders);
        setCollections(collectionResult.collections);
        setTags(tagResult.tags);
      } catch {
        // Navigation data is best-effort; the grid still works without it.
      }
    })();
  }, [phase, libraryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchScope = useMemo(() => {
    if (scope.kind === 'collection') {
      return { kind: 'collection' as const, collectionId: scope.collectionId, recursive };
    }
    return {
      kind: 'folder' as const,
      folderId: scope.kind === 'folder' ? scope.folderId : null,
      recursive,
    };
  }, [scope, recursive]);

  const loadPage = useCallback(
    async (offset: number) => {
      if (libraryId === null) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      try {
        const result = await api.search({
          libraryId,
          query: debouncedQuery,
          scope: searchScope,
          sort,
          order,
          tag: tagFilter || undefined,
          rating: rating || undefined,
          favorite: favorite === 'any' ? undefined : favorite,
          limit: PAGE_SIZE,
          offset,
        });
        if (requestIdRef.current !== requestId) return;
        setTotal(result.total);
        setAssets((previous) => (offset === 0 ? result.items : [...previous, ...result.items]));
        if (offset === 0) {
          setSelectedIndex(null);
          setDetail(null);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setPhase('login');
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [libraryId, debouncedQuery, searchScope, sort, order, tagFilter, rating, favorite],
  );

  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = window.setTimeout(() => void loadPage(0), 0);
    return () => window.clearTimeout(timer);
  }, [phase, loadPage]);

  const selectAsset = useCallback(
    async (index: number) => {
      setSelectedIndex(index);
      setDetail(null);
      const asset = assets[index];
      if (libraryId === null || asset === undefined) return;
      try {
        setDetail(await api.asset(libraryId, asset.assetId));
      } catch {
        setDetail(null);
      }
    },
    [assets, libraryId],
  );

  const handleLogin = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setLoggingIn(true);
      setLoginError('');
      try {
        await api.login(password);
        const next = await api.state();
        setState(next);
        setPhase('ready');
        setPassword('');
      } catch (error) {
        setLoginError(
          error instanceof ApiError && error.status === 429
            ? t('尝试次数过多，请稍后再试。', 'Too many attempts. Try again later.')
            : t('密码不正确。', 'Incorrect password.'),
        );
      } finally {
        setLoggingIn(false);
      }
    },
    [password],
  );

  const folderList = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
    return [...folders]
      .map((folder) => ({ folder, depth: folderDepth(folder, byId) }))
      .sort((left, right) => left.depth - right.depth || left.folder.name.localeCompare(right.folder.name));
  }, [folders]);

  if (phase === 'loading') {
    return (
      <div className="center-screen">
        <p>{t('正在加载…', 'Loading…')}</p>
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <div className="center-screen">
        <form className="login" onSubmit={handleLogin}>
          <h1>Serpent</h1>
          <p className="login-subtitle">
            {t('输入分享密码以查看资源库。', 'Enter the share password to view this library.')}
          </p>
          <div className="field">
            <label htmlFor="share-password">{t('密码', 'Password')}</label>
            <input
              id="share-password"
              className="input"
              type="password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {loginError !== '' ? <p className="error-text">{loginError}</p> : null}
          <button className="button" type="submit" disabled={loggingIn || password === ''}>
            {t('查看资源库', 'View library')}
          </button>
        </form>
      </div>
    );
  }

  if (state === null || libraryId === null) {
    return (
      <div className="center-screen">
        <p>{t('当前没有可分享的资源库。', 'No library is currently shared.')}</p>
      </div>
    );
  }

  const libraryName = state.library?.displayName ?? 'Serpent';

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <strong title={libraryName}>{libraryName}</strong>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              void api.logout().finally(() => setPhase('login'));
            }}
          >
            {t('退出', 'Sign out')}
          </button>
        </div>

        <div className="nav-group">
          <h2>{t('资源库', 'Library')}</h2>
          <button
            className="nav-item"
            type="button"
            aria-current={scope.kind === 'all'}
            onClick={() => setScope({ kind: 'all' })}
          >
            <span>{t('全部资产', 'All assets')}</span>
          </button>
        </div>

        <div className="nav-group">
          <h2>{t('文件夹', 'Folders')}</h2>
          {folderList.length === 0 ? (
            <p className="nav-empty">{t('暂无文件夹', 'No folders')}</p>
          ) : (
            folderList.map(({ folder, depth }) => (
              <button
                className="nav-item"
                key={folder.folderId}
                type="button"
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                aria-current={scope.kind === 'folder' && scope.folderId === folder.folderId}
                onClick={() => setScope({ kind: 'folder', folderId: folder.folderId })}
              >
                <span>{folder.name}</span>
                <span className="count">{folder.directAssetCount}</span>
              </button>
            ))
          )}
        </div>

        <div className="nav-group">
          <h2>{t('合集', 'Collections')}</h2>
          {collections.length === 0 ? (
            <p className="nav-empty">{t('暂无合集', 'No collections')}</p>
          ) : (
            collections.map((collection) => (
              <button
                className="nav-item"
                key={collection.collectionId}
                type="button"
                aria-current={
                  scope.kind === 'collection' && scope.collectionId === collection.collectionId
                }
                onClick={() => setScope({ kind: 'collection', collectionId: collection.collectionId })}
              >
                <span>{collection.name}</span>
                <span className="count">{collection.assetCount}</span>
              </button>
            ))
          )}
        </div>
      </nav>

      <main className="main">
        <div className="toolbar">
          <input
            className="input grow"
            type="search"
            placeholder={t('搜索文件名、标签、描述…', 'Search names, tags, descriptions…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select className="select" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">{t('名称', 'Name')}</option>
            <option value="modified_at">{t('修改时间', 'Modified')}</option>
            <option value="created_at">{t('添加时间', 'Created')}</option>
            <option value="byte_size">{t('大小', 'Size')}</option>
            <option value="rating">{t('评分', 'Rating')}</option>
          </select>
          <select className="select" value={order} onChange={(event) => setOrder(event.target.value)}>
            <option value="asc">{t('升序', 'Ascending')}</option>
            <option value="desc">{t('降序', 'Descending')}</option>
          </select>
          <select className="select" value={favorite} onChange={(event) => setFavorite(event.target.value)}>
            <option value="any">{t('全部', 'Any')}</option>
            <option value="yes">{t('仅喜欢', 'Favorites')}</option>
            <option value="no">{t('排除喜欢', 'Not favorites')}</option>
          </select>
          <select className="select" value={rating} onChange={(event) => setRating(event.target.value)}>
            <option value="">{t('全部评分', 'Any rating')}</option>
            <option value="1">≥1</option>
            <option value="3">≥3</option>
            <option value="5">5</option>
          </select>
          {tags.length > 0 ? (
            <select className="select" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="">{t('全部标签', 'Any tag')}</option>
              {tags.map((tag) => (
                <option key={tag.tagId} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </select>
          ) : null}
          {scope.kind === 'folder' ? (
            <label className="nav-item" style={{ width: 'auto', gap: 6 }}>
              <input
                type="checkbox"
                checked={recursive}
                onChange={(event) => setRecursive(event.target.checked)}
              />
              <span>{t('包含子文件夹', 'Include subfolders')}</span>
            </label>
          ) : null}
        </div>

        <div className="crumbs">
          {scopeLabel(scope, folders, collections, libraryName)} · {total}
        </div>

        <div className="content">
          <div className="grid-scroll">
            {assets.length === 0 && !loading ? (
              <p className="empty">{t('没有匹配的资产。', 'No matching assets.')}</p>
            ) : (
              <>
                <div className="grid">
                  {assets.map((asset, index) => {
                    const source =
                      asset.thumbnailArtifactId !== null
                        ? thumbnailUrl(libraryId, asset.assetId)
                        : asset.mediaType === 'image'
                          ? sourceUrl(libraryId, asset)
                          : null;
                    return (
                      <button
                        className="card"
                        key={asset.assetId}
                        type="button"
                        data-selected={selectedIndex === index ? 'true' : undefined}
                        onClick={() => void selectAsset(index)}
                        onDoubleClick={() => setViewerIndex(index)}
                      >
                        <span className="card-thumb">
                          {source !== null ? (
                            <img loading="lazy" src={source} alt={asset.displayName} />
                          ) : (
                            <span className="placeholder">
                              {asset.relativeFilePath.split('.').pop() ?? '?'}
                            </span>
                          )}
                          <span className="card-badge">{formatBytes(asset.byteSize)}</span>
                        </span>
                        <span className="card-caption" title={asset.displayName}>
                          {asset.displayName}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {assets.length < total ? (
                  <div className="load-more">
                    <button
                      className="button ghost"
                      type="button"
                      disabled={loading}
                      onClick={() => void loadPage(assets.length)}
                    >
                      {loading ? t('加载中…', 'Loading…') : t('加载更多', 'Load more')}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {detail !== null ? (
            <DetailPanel
              libraryId={libraryId}
              detail={detail}
              allowDownload={state.allowDownload}
              onClose={() => {
                setDetail(null);
                setSelectedIndex(null);
              }}
            />
          ) : null}
        </div>
      </main>

      {viewerIndex !== null ? (
        <Viewer
          libraryId={libraryId}
          assets={assets}
          index={viewerIndex}
          allowDownload={state.allowDownload}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
        />
      ) : null}
    </div>
  );
}
