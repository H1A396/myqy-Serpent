import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { AssetSummary } from '../../shared/asset-types';
import type { WebShareDerivativeFormat } from '../../shared/web-share';
import { downloadUrl, sourceUrl, viewUrl } from './api';
import { t } from './i18n';

const MIN_SCALE = 1;
const MAX_SCALE = 8;

/** Download choices for an image. Every entry re-encodes the original. */
const IMAGE_DOWNLOAD_FORMATS: ReadonlyArray<{ format: WebShareDerivativeFormat; label: string }> = [
  { format: 'jpeg', label: 'JPG' },
  { format: 'webp', label: 'WebP' },
  { format: 'png', label: 'PNG' },
];

/**
 * Zoomable/pannable image that loads the original source only in the viewer.
 * `dragMovedRef` records whether the current gesture actually panned, so the
 * viewer's background-click handler can ignore the click that ends a drag.
 */
function ZoomImage({
  src,
  alt,
  dragMovedRef,
}: {
  src: string;
  alt: string;
  dragMovedRef: { current: boolean };
}): ReactNode {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
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

  return (
    <div className="zoom-stage">
      <img
        alt={alt}
        draggable={false}
        ref={imageRef}
        src={src}
        style={{
          cursor: scale > 1 ? 'grab' : 'zoom-in',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }}
        onDoubleClick={() => (scale > 1 ? reset() : setScale(2))}
        onPointerDown={(event) => {
          dragMovedRef.current = false;
          if (scale <= 1) return;
          dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag === null) return;
          dragMovedRef.current = true;
          setOffset({
            x: drag.ox + (event.clientX - drag.x),
            y: drag.oy + (event.clientY - drag.y),
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
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
 * Download control: the original plus bounded re-encodes. Every option is an
 * `<a download>` so the browser owns the save, and each format is encoded from
 * the original — never from the WebP the viewer displays.
 */
function DownloadMenu({
  libraryId,
  asset,
}: {
  libraryId: string;
  asset: AssetSummary;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container !== null && event.target instanceof Node && container.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const isImage = asset.mediaType === 'image';

  return (
    <div className="download-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="button viewer-download"
        type="button"
        onClick={() => setOpen((previous) => !previous)}
      >
        {t('下载', 'Download')}
      </button>
      {open ? (
        <div className="download-menu-surface" role="menu">
          <a
            className="download-menu-item"
            href={downloadUrl(libraryId, asset)}
            download
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            {t('原图', 'Original')}
          </a>
          {isImage
            ? IMAGE_DOWNLOAD_FORMATS.map((entry) => (
                <a
                  className="download-menu-item"
                  download
                  href={viewUrl(libraryId, asset, { format: entry.format, download: true })}
                  key={entry.format}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  {entry.label}
                </a>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

export function Viewer({
  libraryId,
  assets,
  index,
  allowDownload,
  onClose,
  onNavigate,
}: {
  libraryId: string;
  assets: readonly AssetSummary[];
  index: number;
  allowDownload: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const asset = assets[index];
  const dragMovedRef = useRef(false);

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
  const src = asset.mediaType === 'image' ? viewUrl(libraryId, asset) : sourceUrl(libraryId, asset);
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
          {allowDownload ? <DownloadMenu libraryId={libraryId} asset={asset} /> : null}
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
            alt={asset.displayName}
            dragMovedRef={dragMovedRef}
          />
        ) : asset.mediaType === 'video' ? (
          <video key={asset.assetId} src={src} controls autoPlay playsInline />
        ) : asset.mediaType === 'audio' ? (
          <audio key={asset.assetId} src={src} controls autoPlay />
        ) : (
          <div className="viewer-fallback">
            <p>
              {t(
                '该格式无法在浏览器中预览，可下载后使用本地软件打开。',
                'This format cannot be previewed in the browser. Download it to open locally.',
              )}
            </p>
            {allowDownload ? <DownloadMenu libraryId={libraryId} asset={asset} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}
