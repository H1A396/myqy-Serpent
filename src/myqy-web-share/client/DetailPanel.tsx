import type { ReactNode } from 'react';

import type { AssetSummary } from '../../shared/asset-types';
import type { AssetDetail, VisitorMarks } from './api';
import { downloadUrl, viewUrl } from './api';
import { formatDate, formatDuration, mediaTypeLabel, truncateMiddle } from './format';
import { PREFERS_CHINESE, t } from './i18n';

/** Clickable 1–5 stars; clicking the current value clears it. */
function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}): ReactNode {
  return (
    <span className="star-rating" role="radiogroup" aria-label={t('评分', 'Rating')}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          aria-checked={value === star}
          aria-label={String(star)}
          className="star-button"
          key={star}
          role="radio"
          type="button"
          onClick={() => onChange(value === star ? 0 : star)}
        >
          {star <= value ? '★' : '☆'}
        </button>
      ))}
    </span>
  );
}

function stringField(metadata: Record<string, unknown> | null, key: string): string | null {
  if (metadata === null) return null;
  const value = metadata[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Inspector panel for the selected asset. It renders the `AssetSummary` the
 * grid already has immediately (name/size/dimensions/…), then fills in the
 * richer metadata once `detail` for the same asset arrives. Keeping the panel
 * mounted and summary-first is what prevents the grid column from collapsing
 * and reflowing on every selection.
 */
export function DetailPanel({
  libraryId,
  summary,
  detail,
  allowDownload,
  marks,
  onMarksChange,
  onClose,
}: {
  libraryId: string;
  summary: AssetSummary;
  detail: AssetDetail | null;
  allowDownload: boolean;
  marks: VisitorMarks;
  onMarksChange: (patch: { favorite?: boolean; rating?: number }) => void;
  onClose: () => void;
}) {
  // A detail response for a previously selected asset must never be shown
  // against the newly selected one.
  const activeDetail = detail !== null && detail.asset.assetId === summary.assetId ? detail : null;
  const metadata = activeDetail?.metadata ?? null;
  const extracted = activeDetail?.extracted ?? null;

  const camera = [
    stringField(extracted?.metadata ?? null, 'cameraMake'),
    stringField(extracted?.metadata ?? null, 'cameraModel'),
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
  const author = metadata?.author ?? stringField(extracted?.metadata ?? null, 'author');
  const captureDate = stringField(extracted?.metadata ?? null, 'captureDate');
  const tags = metadata?.tags ?? [];

  return (
    <aside className="detail" aria-label={t('资产详情', 'Asset details')}>
      <div className="detail-actions">
        <button className="button ghost" type="button" onClick={onClose}>
          {t('收起', 'Hide')}
        </button>
        {allowDownload ? (
          <>
            {summary.mediaType === 'image' ? (
              <a
                className="button"
                href={viewUrl(libraryId, summary, { download: true })}
                download
              >
                {t('下载', 'Download')}
              </a>
            ) : null}
            <a className="button download-original" href={downloadUrl(libraryId, summary)} download>
              {t('下载原图', 'Download original')}
            </a>
          </>
        ) : null}
      </div>

      <h2 title={summary.displayName}>{truncateMiddle(summary.displayName)}</h2>

      <section className="detail-section">
        <h3>{t('信息', 'Info')}</h3>
        <dl>
          <dt>{t('类型', 'Type')}</dt>
          <dd>{mediaTypeLabel(summary.mediaType, PREFERS_CHINESE)}</dd>
          {summary.durationMs !== null && summary.durationMs !== undefined && summary.durationMs > 0 ? (
            <>
              <dt>{t('时长', 'Duration')}</dt>
              <dd>{formatDuration(summary.durationMs)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="detail-section">
        <h3>{t('我的标记', 'My marks')}</h3>
        <dl>
          <dt>{t('评分', 'Rating')}</dt>
          <dd>
            <StarRating
              value={marks.rating}
              onChange={(rating) => onMarksChange({ rating })}
            />
          </dd>
          <dt>{t('喜欢', 'Like')}</dt>
          <dd>
            <button
              aria-pressed={marks.favorite}
              className="mark-toggle"
              type="button"
              onClick={() => onMarksChange({ favorite: !marks.favorite })}
            >
              {marks.favorite ? t('已喜欢 · 点击取消', 'Liked · click to undo') : t('喜欢', 'Like')}
            </button>
          </dd>
        </dl>
      </section>

      {tags.length > 0 ? (
        <section className="detail-section">
          <h3>{t('标签', 'Tags')}</h3>
          <div className="chips">
            {tags.map((tag) => (
              <span className="chip" key={tag.id}>
                {tag.name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {metadata !== null && metadata.description !== null && metadata.description !== '' ? (
        <section className="detail-section">
          <h3>{t('描述', 'Description')}</h3>
          <p>{metadata.description}</p>
        </section>
      ) : null}

      {author !== null || camera !== '' || captureDate !== null ? (
        <section className="detail-section">
          <h3>{t('拍摄信息', 'Capture')}</h3>
          <dl>
            {author !== null ? (
              <>
                <dt>{t('作者', 'Author')}</dt>
                <dd>{author}</dd>
              </>
            ) : null}
            {camera !== '' ? (
              <>
                <dt>{t('相机', 'Camera')}</dt>
                <dd>{camera}</dd>
              </>
            ) : null}
            {captureDate !== null ? (
              <>
                <dt>{t('拍摄时间', 'Captured')}</dt>
                <dd>{formatDate(captureDate)}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      {metadata !== null && metadata.sourcePageUrl !== null && metadata.sourcePageUrl !== '' ? (
        <section className="detail-section">
          <h3>{t('来源', 'Source')}</h3>
          <p>
            <a href={metadata.sourcePageUrl} target="_blank" rel="noreferrer noopener">
              {metadata.sourcePageUrl}
            </a>
          </p>
        </section>
      ) : null}
    </aside>
  );
}
