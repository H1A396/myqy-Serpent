import { useEffect } from 'react';

import type { AssetSummary } from '../shared/asset-types';
import { downloadUrl, sourceUrl } from './api';
import { t } from './i18n';

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowRight' && index + 1 < assets.length) onNavigate(index + 1);
      if (event.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assets.length, index, onClose, onNavigate]);

  if (asset === undefined) return null;
  const src = sourceUrl(libraryId, asset);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={asset.displayName}>
      <div className="viewer-header">
        <button className="button ghost" type="button" onClick={onClose}>
          {t('关闭', 'Close')}
        </button>
        <span className="viewer-title">{asset.displayName}</span>
        <span className="count">
          {index + 1} / {assets.length}
        </span>
        {allowDownload ? (
          <a className="button ghost" href={downloadUrl(libraryId, asset)} download>
            {t('下载原图', 'Download')}
          </a>
        ) : null}
      </div>
      <div className="viewer-body">
        {asset.mediaType === 'image' ? (
          <img src={src} alt={asset.displayName} />
        ) : asset.mediaType === 'video' ? (
          <video src={src} controls autoPlay playsInline />
        ) : asset.mediaType === 'audio' ? (
          <audio src={src} controls autoPlay />
        ) : (
          <div className="viewer-fallback">
            <p>
              {t(
                '该格式无法在浏览器中预览，可下载后使用本地软件打开。',
                'This format cannot be previewed in the browser. Download it to open locally.',
              )}
            </p>
            {allowDownload ? (
              <a className="button" href={downloadUrl(libraryId, asset)} download>
                {t('下载原图', 'Download')}
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
