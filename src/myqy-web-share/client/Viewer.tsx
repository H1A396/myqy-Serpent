import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { AssetSummary } from '../../shared/asset-types';
import { downloadUrl, sourceUrl, viewUrl, type VisitorMarks } from './api';
import { t } from './i18n';
import { prefetchCache } from './prefetch-cache';
import { prefetchQueue } from './prefetch-queue';

const MIN_SCALE = 1;
const MAX_SCALE = 8;

/**
 * Zoomable/pannable image with a two-tier LOD.
 *
 * `src` is the default (quality-82) derivative, shown immediately. Once the
 * visitor zooms in (scale > 1), `srcHigh` (quality-100) is preloaded and swapped
 * in only after it has decoded, so the upgrade never flashes a blank frame. The
 * scale/offset live here and are deliberately *not* reset when the source swaps:
 * both tiers share the same bounding edge, so the transform stays visually
 * identical. Zooming back to 1 keeps the high tier until the viewer closes.
 *
 * `dragMovedRef` records whether the current gesture actually panned, so the
 * viewer's background-click handler can ignore the click that ends a drag.
 */
function ZoomImage({
  src,
  srcHigh,
  alt,
  dragMovedRef,
}: {
  src: string;
  srcHigh?: string;
  alt: string;
  dragMovedRef: { current: boolean };
}): ReactNode {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // The image actually painted (may be upgraded from `src` to `srcHigh`).
  const [displaySrc, setDisplaySrc] = useState(src);
  // The other layer: kept until it has loaded, then revealed (cross-fade).
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  // The only zoom gesture is the wheel, so the pointer is a grab hand — never a
  // magnifier. `grabbing` shows while a pan drag is in progress.
  const [dragging, setDragging] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef(scale);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Swap in the high tier once the visitor zooms in, but only after the bytes
  // have fully decoded — a preload + decode, then a layered reveal. Zooming back
  // out keeps what is shown (per product decision, the high tier stays until the
  // viewer closes), so this never downgrades.
  useEffect(() => {
    if (srcHigh === undefined || scale <= 1) return;
    if (displaySrc === srcHigh || pendingSrc === srcHigh) return;
    let active = true;
    const probe = new Image();
    probe.src = srcHigh;
    const reveal = () => {
      if (!active) return;
      setPendingSrc(srcHigh);
    };
    if (typeof probe.decode === 'function') {
      probe.decode().then(reveal, () => undefined).catch(() => undefined);
    } else if (probe.complete) {
      reveal();
    } else {
      probe.onload = reveal;
    }
    return () => {
      active = false;
    };
  }, [displaySrc, pendingSrc, scale, srcHigh]);

  const zoomBy = useCallback((factor: number, originX?: number, originY?: number) => {
    const current = scaleRef.current;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor));
    if (next === MIN_SCALE) {
      setScale(MIN_SCALE);
      setOffset({ x: 0, y: 0 });
      return;
    }
    const element = imageRef.current;
    if (element !== null && originX !== undefined && originY !== undefined) {
      const rect = element.getBoundingClientRect();
      const ratio = next / current;
      const cx = originX - (rect.left + rect.width / 2);
      const cy = originY - (rect.top + rect.height / 2);
      setOffset((previous) => ({
        x: previous.x - cx * (ratio - 1),
        y: previous.y - cy * (ratio - 1),
      }));
    }
    setScale(next);
  }, []);

  // React attaches onWheel passively, so preventDefault needs a native listener.
  useEffect(() => {
    const element = imageRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') zoomBy(1.25);
      else if (event.key === '-') zoomBy(1 / 1.25);
      else if (event.key === '0') reset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reset, zoomBy]);

  const transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  const imageStyle = {
    cursor: dragging ? 'grabbing' : 'grab',
    transform,
  };

  // Pointer/double-click handlers are shared by both layers so the gesture works
  // whichever layer is on top.
  const interactiveHandlers = {
    onDoubleClick: () => (scale > 1 ? reset() : setScale(2)),
    onPointerDown: (event: React.PointerEvent<HTMLImageElement>) => {
      dragMovedRef.current = false;
      if (scale <= 1) return;
      dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove: (event: React.PointerEvent<HTMLImageElement>) => {
      const drag = dragRef.current;
      if (drag === null) return;
      dragMovedRef.current = true;
      setOffset({
        x: drag.ox + (event.clientX - drag.x),
        y: drag.oy + (event.clientY - drag.y),
      });
    },
    onPointerUp: () => {
      dragRef.current = null;
      setDragging(false);
    },
    onPointerCancel: () => {
      dragRef.current = null;
      setDragging(false);
    },
  };

  return (
    <div className="zoom-stage">
      {pendingSrc !== null ? (
        <img
          alt=""
          aria-hidden="true"
          className="zoom-layer zoom-layer-pending"
          decoding="async"
          draggable={false}
          src={pendingSrc}
          style={imageStyle}
          onLoad={() => {
            // Reveal only once the high tier has painted, then it becomes the
            // displayed layer (no remount, so scale/offset are preserved).
            setDisplaySrc(pendingSrc);
            setPendingSrc(null);
          }}
        />
      ) : null}
      <img
        alt={alt}
        decoding="async"
        draggable={false}
        fetchPriority="high"
        ref={imageRef}
        src={displaySrc}
        style={imageStyle}
        {...interactiveHandlers}
      />
      {scale > 1 ? (
        <button className="zoom-reset" type="button" onClick={reset}>
          {t('重置缩放', 'Reset zoom')} · {Math.round(scale * 100)}%
        </button>
      ) : null}
    </div>
  );
}

/**
 * Download control for formats the viewer cannot render: only the original.
 * The re-encoded JPEG "Download" is offered for images in the header.
 */
function FallbackDownload({
  libraryId,
  asset,
}: {
  libraryId: string;
  asset: AssetSummary;
}): ReactNode {
  return (
    <a className="button" href={downloadUrl(libraryId, asset)} download>
      {t('下载原图', 'Download original')}
    </a>
  );
}

export function Viewer({
  libraryId,
  assets,
  index,
  allowDownload,
  marks,
  onMarksChange,
  onClose,
  onNavigate,
}: {
  libraryId: string;
  assets: readonly AssetSummary[];
  index: number;
  allowDownload: boolean;
  marks: VisitorMarks;
  onMarksChange: (patch: { favorite?: boolean; rating?: number }) => void;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const asset = assets[index];
  const dragMovedRef = useRef(false);

  // Background prefetch must yield to the visitor: while the viewer is open the
  // queue pauses, and resumes (from where it stopped) on close.
  useEffect(() => {
    prefetchQueue.pause();
    return () => prefetchQueue.resume();
  }, []);

  // Prefer an already-prefetched tier (persistent cache) over the network. The
  // object URLs are revoked when the asset changes or the viewer closes.
  const lowUrl = asset !== undefined && asset.mediaType === 'image'
    ? viewUrl(libraryId, asset)
    : undefined;
  const highUrl = asset !== undefined && asset.mediaType === 'image'
    ? viewUrl(libraryId, asset, { tier: 'high' })
    : undefined;
  const [cachedLow, setCachedLow] = useState<string | undefined>(undefined);
  const [cachedHigh, setCachedHigh] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (asset === undefined || asset.mediaType !== 'image') return;
    let active = true;
    const created: string[] = [];
    const base = {
      libraryId,
      assetId: asset.assetId,
      revisionId: asset.currentRevisionId,
    };
    void (async () => {
      const lowBlob = await prefetchCache.get({ ...base, tier: 'low' });
      const highBlob = await prefetchCache.get({ ...base, tier: 'high' });
      if (!active) return;
      if (lowBlob !== undefined) {
        const url = URL.createObjectURL(lowBlob);
        created.push(url);
        setCachedLow(url);
      }
      if (highBlob !== undefined) {
        const url = URL.createObjectURL(highBlob);
        created.push(url);
        setCachedHigh(url);
      }
    })();
    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
      // Clear for the next asset so a stale blob URL is never reused.
      setCachedLow(undefined);
      setCachedHigh(undefined);
    };
  }, [asset, libraryId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight' && index + 1 < assets.length) onNavigate(index + 1);
      else if (event.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assets.length, index, onClose, onNavigate]);

  // Clicking the empty area around the media exits the viewer, matching the
  // desktop viewer. Clicks on the media, controls or a pan gesture are ignored.
  const handleBackgroundClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const moved = dragMovedRef.current;
      dragMovedRef.current = false;
      if (moved) return;
      const target = event.target as HTMLElement;
      if (target.closest('img, video, audio, button, a, .viewer-fallback')) return;
      onClose();
    },
    [onClose],
  );

  if (asset === undefined) return null;
  // Images use the bounded derivative so a slow tunnel is not asked for a
  // 10–30 MB source; the download menu still offers the original. Video and
  // audio have no bounded derivative yet and keep streaming their source.
  const src = asset.mediaType === 'image'
    ? (cachedLow ?? lowUrl ?? viewUrl(libraryId, asset))
    : sourceUrl(libraryId, asset);
  const srcHigh = asset.mediaType === 'image' ? (cachedHigh ?? highUrl) : undefined;
  const hasPrevious = index > 0;
  const hasNext = index + 1 < assets.length;

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={asset.displayName}>
      <div className="viewer-header">
        <div className="viewer-header-left">
          <button className="button viewer-close" type="button" onClick={onClose}>
            {t('关闭', 'Close')}
          </button>
          <span className="viewer-hints">
            {t(
              '滚轮缩放 · 左键拖动 · 双击缩放',
              'Scroll to zoom · Drag to pan · Double-click to zoom',
            )}
          </span>
        </div>
        <div className="viewer-header-center">
          <span className="viewer-title" title={asset.displayName}>
            {asset.displayName}
          </span>
          <span className="viewer-counter">
            {index + 1} / {assets.length}
          </span>
        </div>
        <div className="viewer-header-right">
          <button
            aria-pressed={marks.favorite}
            className="button viewer-like"
            type="button"
            title={marks.favorite ? t('取消喜欢', 'Unlike') : t('喜欢', 'Like')}
            onClick={() => onMarksChange({ favorite: !marks.favorite })}
          >
            {marks.favorite ? '★' : '☆'} {t('喜欢', 'Like')}
          </button>
          {allowDownload ? (
            <>
              {asset.mediaType === 'image' ? (
                <a
                  className="button"
                  href={viewUrl(libraryId, asset, { download: true })}
                  download
                >
                  {t('下载', 'Download')}
                </a>
              ) : null}
              <a className="button download-original" href={downloadUrl(libraryId, asset)} download>
                {t('下载原图', 'Download original')}
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div className="viewer-body" onClick={handleBackgroundClick}>
        {hasPrevious ? (
          <button
            aria-label={t('上一张', 'Previous')}
            className="viewer-nav viewer-nav-prev"
            type="button"
            onClick={() => onNavigate(index - 1)}
          >
            <svg aria-hidden="true" height="20" viewBox="0 0 20 20" width="20">
              <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
        {hasNext ? (
          <button
            aria-label={t('下一张', 'Next')}
            className="viewer-nav viewer-nav-next"
            type="button"
            onClick={() => onNavigate(index + 1)}
          >
            <svg aria-hidden="true" height="20" viewBox="0 0 20 20" width="20">
              <path d="M7.5 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}

        {asset.mediaType === 'image' ? (
          <ZoomImage
            key={asset.assetId}
            src={src}
            srcHigh={srcHigh}
            alt={asset.displayName}
            dragMovedRef={dragMovedRef}
          />
        ) : asset.mediaType === 'video' ? (
          <video key={asset.assetId} src={src} controls autoPlay playsInline preload="auto" />
        ) : asset.mediaType === 'audio' ? (
          <audio key={asset.assetId} src={src} controls autoPlay preload="auto" />
        ) : (
          <div className="viewer-fallback">
            <p>
              {t(
                '该格式无法在浏览器中预览，可下载后使用本地软件打开。',
                'This format cannot be previewed in the browser. Download it to open locally.',
              )}
            </p>
            {allowDownload ? <FallbackDownload libraryId={libraryId} asset={asset} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}
