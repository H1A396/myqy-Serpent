import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AssetSummary, CollectionSummary, ManagedFolderSummary, TagSummary } from '../../shared/asset-types';
import {
  api,
  ApiError,
  thumbnailUrl,
  type AssetDetail,
  type VisitorMarks,
  type WebShareState,
} from './api';
import { DetailPanel } from './DetailPanel';
import { formatBytes } from './format';
import { t } from './i18n';
import { Viewer } from './Viewer';

const PAGE_SIZE = 100;
const THUMBNAIL_RETRY_LIMIT = 6;
const SKELETON_TILES = 12;
const SEARCH_CACHE_LIMIT = 24;

/** Stable identity for one (library, scope, sort, filters, query) listing. */
function searchCacheKey(parts: readonly unknown[]): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join('\u0001');
}

type Scope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'collection'; collectionId: string };

interface TreeItem {
  id: string;
  name: string;
  parentId: string | null;
  count: number;
}

/** Indented, collapsible navigation tree (folders / collections). */
function SidebarTree({
  items,
  activeId,
  emptyLabel,
  onSelect,
}: {
  items: readonly TreeItem[];
  activeId: string | null;
  emptyLabel: string;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, TreeItem[]>();
    for (const item of items) {
      const bucket = map.get(item.parentId);
      if (bucket === undefined) map.set(item.parentId, [item]);
      else bucket.push(item);
    }
    for (const bucket of map.values()) {
      // Match the desktop's default sidebar order: name ascending with the same
      // numeric/case-insensitive collation.
      bucket.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
      );
    }
    return map;
  }, [items]);

  const rows = useMemo(() => {
    const output: Array<{ item: TreeItem; depth: number; hasChildren: boolean }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const item of childrenOf.get(parentId) ?? []) {
        const children = childrenOf.get(item.id) ?? [];
        output.push({ item, depth, hasChildren: children.length > 0 });
        if (children.length > 0 && !collapsed.has(item.id)) walk(item.id, depth + 1);
      }
    };
    walk(null, 0);
    return output;
  }, [childrenOf, collapsed]);

  if (items.length === 0) return <p className="nav-empty">{emptyLabel}</p>;

  return (
    <>
      {rows.map(({ item, depth, hasChildren }) => {
        const isCollapsed = collapsed.has(item.id);
        return (
          <div className="nav-row" key={item.id} style={{ paddingLeft: `${depth * 14}px` }}>
            {hasChildren ? (
              <button
                aria-label={isCollapsed ? t('展开', 'Expand') : t('折叠', 'Collapse')}
                aria-expanded={!isCollapsed}
                className={`tree-toggle${isCollapsed ? ' is-collapsed' : ''}`}
                onClick={() => {
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                }}
                type="button"
              >
                <svg aria-hidden="true" height="10" viewBox="0 0 10 10" width="10">
                  <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            ) : (
              <span className="tree-toggle-spacer" />
            )}
            <button
              className="nav-item"
              type="button"
              aria-current={activeId === item.id}
              onClick={() => onSelect(item.id)}
              title={item.name}
            >
              <span className="nav-item-name">{item.name}</span>
              <span className="count">{item.count}</span>
            </button>
          </div>
        );
      })}
    </>
  );
}

/**
 * Thumbnail tile. A share visitor can be the first to request an asset whose
 * thumbnail has not been generated yet, so a failed load is retried with a
 * backoff while the Worker produces the artifact. The original file is never
 * requested here; it is only fetched by the viewer.
 */
function Thumb({ url, alt }: { url: string; alt: string }) {
  const [attempt, setAttempt] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const extension = alt.includes('.') ? alt.split('.').pop() : '';

  if (exhausted) {
    return <span className="placeholder">{(extension ?? '').toUpperCase() || '?'}</span>;
  }
  return (
    <img
      alt={alt}
      loading="lazy"
      src={attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`}
      onError={() => {
        if (attempt >= THUMBNAIL_RETRY_LIMIT) {
          setExhausted(true);
          return;
        }
        window.setTimeout(() => setAttempt((value) => value + 1), 800 + attempt * 700);
      }}
    />
  );
}

function folderTreeItems(folders: readonly ManagedFolderSummary[]): TreeItem[] {
  return folders.map((folder) => ({
    id: folder.folderId,
    name: folder.name,
    parentId: folder.parentFolderId,
    count: folder.directAssetCount,
  }));
}

function collectionTreeItems(collections: readonly CollectionSummary[]): TreeItem[] {
  return collections.map((collection) => ({
    id: collection.collectionId,
    name: collection.name,
    parentId: collection.parentId,
    count: collection.assetCount,
  }));
}

function scopeLabel(
  scope: Scope,
  folders: readonly ManagedFolderSummary[],
  collections: readonly CollectionSummary[],
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [debugAllowed, setDebugAllowed] = useState(false);
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
  /** The visitor's own marks, keyed by asset id. */
  const [marksByAsset, setMarksByAsset] = useState<Record<string, VisitorMarks>>({});
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  /** Last listing per key, so switching a collection back is instant. */
  const searchCacheRef = useRef(new Map<string, { items: AssetSummary[]; total: number }>());
  // Test-only, and only from a direct local browser: `?debug=1` plus the server
  // confirming the request did not arrive through a tunnel.
  const debugMode =
    debugAllowed &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';
  /**
   * Assets the visitor has edited this session. A late-arriving mark read (the
   * initial GET or a detail response) must never overwrite a fresh local edit,
   * and a stale response must not supersede a newer click.
   */
  const mutatedAssetsRef = useRef(new Set<string>());
  const markRequestSeqRef = useRef<Record<string, number>>({});

  const libraryId = state?.sharedLibraryId ?? null;

  useEffect(() => {
    void (async () => {
      // The login screen needs to know whether a password is configured before
      // it can render the right fields; /api/config is unauthenticated.
      try {
        const config = await api.config();
        setRequiresPassword(config.requiresPassword);
        setDebugAllowed(config.debug === true);
      } catch {
        // Older share server without /api/config: assume username-only.
      }
      try {
        const next = await api.state();
        setState(next);
        setPhase('ready');
      } catch {
        // Missing or expired session.
        setPhase('login');
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
          // Cache the fresh first page (stale-while-revalidate reads it back).
          const key = searchCacheKey([
            libraryId,
            searchScope,
            sort,
            order,
            tagFilter,
            rating,
            favorite,
            debouncedQuery,
          ]);
          const cache = searchCacheRef.current;
          cache.delete(key);
          cache.set(key, { items: result.items, total: result.total });
          while (cache.size > SEARCH_CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
          }
          detailRequestIdRef.current += 1;
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
    if (phase !== 'ready' || libraryId === null) return;
    // Switch the grid the instant the scope/sort changes: show the cached
    // listing if we have one, otherwise a skeleton — never freeze the previous
    // collection while the request is in flight. The fetch below then refreshes
    // in the background (stale-while-revalidate).
    detailRequestIdRef.current += 1;
    const key = searchCacheKey([
      libraryId,
      searchScope,
      sort,
      order,
      tagFilter,
      rating,
      favorite,
      debouncedQuery,
    ]);
    const cached = searchCacheRef.current.get(key);
    // This effect is the one place that reacts to a changed listing key, so
    // swapping the view here is intentional (not a render-phase anti-pattern).
    /* eslint-disable react-hooks/set-state-in-effect -- scope-key transition */
    setSelectedIndex(null);
    setDetail(null);
    setAssets(cached?.items ?? []);
    setTotal(cached?.total ?? 0);
    /* eslint-enable react-hooks/set-state-in-effect */
    const timer = window.setTimeout(() => void loadPage(0), 0);
    return () => window.clearTimeout(timer);
  }, [phase, libraryId, searchScope, sort, order, tagFilter, rating, favorite, debouncedQuery, loadPage]);

  const selectAsset = useCallback(
    (index: number) => {
      // Re-clicking the current card must not refetch or reflow the panel.
      if (index === selectedIndex) return;
      setSelectedIndex(index);
      setDetail(null);
      const asset = assets[index];
      if (libraryId === null || asset === undefined) return;
      const detailRequestId = detailRequestIdRef.current + 1;
      detailRequestIdRef.current = detailRequestId;
      void (async () => {
        try {
          const next = await api.asset(libraryId, asset.assetId);
          if (detailRequestIdRef.current !== detailRequestId) return;
          setDetail(next);
          if (next.marks !== undefined && !mutatedAssetsRef.current.has(asset.assetId)) {
            const marks = next.marks;
            setMarksByAsset((previous) => ({ ...previous, [asset.assetId]: marks }));
          }
        } catch {
          if (detailRequestIdRef.current === detailRequestId) setDetail(null);
        }
      })();
    },
    [assets, libraryId, selectedIndex],
  );

  /** Optimistically set the visitor's mark, then reconcile with the server. */
  const updateMarks = useCallback(
    async (assetId: string, patch: { favorite?: boolean; rating?: number }) => {
      if (libraryId === null) return;
      mutatedAssetsRef.current.add(assetId);
      const seq = (markRequestSeqRef.current[assetId] ?? 0) + 1;
      markRequestSeqRef.current[assetId] = seq;
      const previous = marksByAsset[assetId] ?? { favorite: false, rating: 0 };
      setMarksByAsset((current) => ({ ...current, [assetId]: { ...previous, ...patch } }));
      try {
        const result = await api.setMarks(libraryId, assetId, patch);
        // A newer click already superseded this response; keep its state.
        if (markRequestSeqRef.current[assetId] !== seq) return;
        setMarksByAsset((current) => ({ ...current, [assetId]: result.marks }));
      } catch {
        if (markRequestSeqRef.current[assetId] !== seq) return;
        setMarksByAsset((current) => ({ ...current, [assetId]: previous }));
      }
    },
    [libraryId, marksByAsset],
  );

  const handleLogin = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setLoggingIn(true);
      setLoginError('');
      try {
        await api.login(username.trim(), requiresPassword ? password : undefined);
        setState(await api.state());
        setPhase('ready');
        setPassword('');
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          setLoginError(t('尝试次数过多，请稍后再试。', 'Too many attempts. Try again later.'));
        } else if (requiresPassword) {
          setLoginError(t('密码不正确。', 'Incorrect password.'));
        } else {
          setLoginError(t('无法进入，请重试。', 'Could not sign in. Try again.'));
        }
      } finally {
        setLoggingIn(false);
      }
    },
    [username, password, requiresPassword],
  );

  // --- Test-only simulation (?debug=1). Inserts a fake card at the position a
  // freshly sorted server response would put it, so the update flow is visible.
  const insertSimulatedAsset = useCallback(() => {
    const nonce = Date.now();
    const name = `模拟新图-sim-${String(nonce).slice(-4)}.png`;
    const asset: AssetSummary = {
      assetId: `sim-${nonce}`,
      locationKind: 'managed',
      managedFolderId: null,
      relativeFilePath: name,
      displayName: name,
      currentRevisionId: 'sim-rev',
      byteSize: 1_234_567,
      modifiedAt: new Date(nonce).toISOString(),
      availability: 'available',
      rating: 0,
      favorite: false,
      deletedAt: null,
      trashedFromPath: null,
      trashedFromTombstoneId: null,
      remainingDays: null,
      thumbnailStatus: 'failed',
      thumbnailArtifactId: null,
      mediaType: 'image',
      width: 2048,
      height: 2048,
      durationMs: null,
    };
    setAssets((previous) => {
      const next = [...previous, asset];
      if (sort === 'name') {
        const direction = order === 'desc' ? -1 : 1;
        next.sort((left, right) => direction * left.displayName.localeCompare(right.displayName));
      } else {
        // Put it in the middle, where a re-sorted response would land it.
        const middle = Math.floor(next.length / 2);
        next.splice(middle, 0, next.pop()!);
      }
      return next;
    });
    setTotal((value) => value + 1);
  }, [sort, order]);

  const removeSimulatedAsset = useCallback(() => {
    setAssets((previous) => {
      const index = previous.findIndex((item) => item.assetId.startsWith('sim-'));
      if (index >= 0) {
        const next = [...previous];
        next.splice(index, 1);
        return next;
      }
      return previous.length === 0 ? previous : previous.slice(0, -1);
    });
    setTotal((value) => Math.max(0, value - 1));
  }, []);

  const viewerAssetId = viewerIndex === null ? undefined : assets[viewerIndex]?.assetId;
  useEffect(() => {
    if (phase !== 'ready' || libraryId === null || viewerAssetId === undefined) return;
    if (marksByAsset[viewerAssetId] !== undefined) return;
    if (mutatedAssetsRef.current.has(viewerAssetId)) return;
    const assetId = viewerAssetId;
    void (async () => {
      try {
        const { marks } = await api.marks(libraryId, assetId);
        // Never clobber an edit the visitor made while this read was in flight.
        if (mutatedAssetsRef.current.has(assetId)) return;
        setMarksByAsset((current) => ({ ...current, [assetId]: marks }));
      } catch {
        // Leave it unmarked; the like button still works optimistically.
      }
    })();
  }, [phase, libraryId, viewerAssetId, marksByAsset]);

  const folderItems = useMemo(() => folderTreeItems(folders), [folders]);
  const collectionItems = useMemo(() => collectionTreeItems(collections), [collections]);

  if (phase === 'loading') {
    return (
      <div className="center-screen">
        <p>{t('正在加载…', 'Loading…')}</p>
      </div>
    );
  }

  if (phase === 'login') {
    const canSubmit = username.trim() !== '' && (!requiresPassword || password !== '');
    return (
      <div className="center-screen">
        <form className="login" onSubmit={handleLogin}>
          <h1>Serpent</h1>
          <p className="login-subtitle">
            {t(
              '输入一个用户名即可进入，写什么都可以。',
              'Enter any username to continue — any name works.',
            )}
          </p>
          <div className="field">
            <label htmlFor="share-username">{t('用户名', 'Username')}</label>
            <input
              id="share-username"
              className="input"
              type="text"
              autoFocus
              maxLength={64}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          {requiresPassword ? (
            <div className="field">
              <label htmlFor="share-password">{t('密码', 'Password')}</label>
              <input
                id="share-password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          ) : null}
          {loginError !== '' ? <p className="error-text">{loginError}</p> : null}
          <button className="button" type="submit" disabled={loggingIn || !canSubmit}>
            {t('进入资源库', 'Enter library')}
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
  const selectedAsset = selectedIndex === null ? undefined : assets[selectedIndex];
  const viewerAsset = viewerIndex === null ? undefined : assets[viewerIndex];
  const marksFor = (assetId: string): VisitorMarks =>
    marksByAsset[assetId] ?? { favorite: false, rating: 0 };

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
          <div className="nav-row">
            <span className="tree-toggle-spacer" />
            <button
              className="nav-item"
              type="button"
              aria-current={scope.kind === 'all'}
              onClick={() => setScope({ kind: 'all' })}
            >
              <span className="nav-item-name">{t('全部资产', 'All assets')}</span>
            </button>
          </div>
        </div>

        <div className="nav-group">
          <h2>{t('文件夹', 'Folders')}</h2>
          <SidebarTree
            items={folderItems}
            activeId={scope.kind === 'folder' ? scope.folderId : null}
            emptyLabel={t('暂无文件夹', 'No folders')}
            onSelect={(folderId) => setScope({ kind: 'folder', folderId })}
          />
        </div>

        <div className="nav-group">
          <h2>{t('合集', 'Collections')}</h2>
          <SidebarTree
            items={collectionItems}
            activeId={scope.kind === 'collection' ? scope.collectionId : null}
            emptyLabel={t('暂无合集', 'No collections')}
            onSelect={(collectionId) => setScope({ kind: 'collection', collectionId })}
          />
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
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(event) => setRecursive(event.target.checked)}
              />
              <span>{t('包含子文件夹', 'Include subfolders')}</span>
            </label>
          ) : null}
          {debugMode ? (
            <>
              <button className="button ghost" type="button" onClick={insertSimulatedAsset}>
                + 模拟新图
              </button>
              <button className="button ghost" type="button" onClick={removeSimulatedAsset}>
                − 模拟删除
              </button>
            </>
          ) : null}
        </div>

        <div className="content">
          <div className="content-left">
            <div className="crumbs">
              {scopeLabel(scope, folders, collections, libraryName)} · {total}
            </div>

            <div className="grid-scroll">
            {assets.length === 0 && !loading ? (
              <p className="empty">{t('没有匹配的资产。', 'No matching assets.')}</p>
            ) : assets.length === 0 ? (
              <div className="grid">
                {Array.from({ length: SKELETON_TILES }, (_, index) => (
                  <div className="card skeleton" key={index}>
                    <span className="card-thumb" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="grid">
                  {assets.map((asset, index) => (
                    <div
                      className="card"
                      key={asset.assetId}
                      data-selected={selectedIndex === index ? 'true' : undefined}
                      onClick={() => void selectAsset(index)}
                      onDoubleClick={() => setViewerIndex(index)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setViewerIndex(index);
                        if (event.key === ' ') {
                          event.preventDefault();
                          void selectAsset(index);
                        }
                      }}
                    >
                      <span className="card-thumb">
                        {asset.assetId.startsWith('sim-') ? (
                          <span className="placeholder">NEW</span>
                        ) : (
                          <Thumb
                            url={thumbnailUrl(libraryId, asset.assetId)}
                            alt={asset.displayName}
                          />
                        )}
                        <span className="card-badge">{formatBytes(asset.byteSize)}</span>
                        <button
                          aria-label={t('放大查看', 'Open viewer')}
                          className="card-open"
                          onClick={(event) => {
                            event.stopPropagation();
                            setViewerIndex(index);
                          }}
                          title={t('放大查看', 'Open viewer')}
                          type="button"
                        >
                          <svg aria-hidden="true" height="13" viewBox="0 0 14 14" width="13">
                            <path
                              d="M5 2H2v3M9 2h3v3M5 12H2V9M9 12h3V9"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </span>
                      <span className="card-caption" title={asset.displayName}>
                        {asset.displayName}
                      </span>
                    </div>
                  ))}
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
          </div>

          {selectedAsset !== undefined ? (
            <DetailPanel
              libraryId={libraryId}
              summary={selectedAsset}
              detail={detail}
              allowDownload={state.allowDownload}
              marks={marksFor(selectedAsset.assetId)}
              onMarksChange={(patch) => void updateMarks(selectedAsset.assetId, patch)}
              onClose={() => {
                detailRequestIdRef.current += 1;
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
          marks={viewerAsset === undefined ? { favorite: false, rating: 0 } : marksFor(viewerAsset.assetId)}
          onMarksChange={(patch) => {
            if (viewerAsset !== undefined) void updateMarks(viewerAsset.assetId, patch);
          }}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
        />
      ) : null}
    </div>
  );
}
