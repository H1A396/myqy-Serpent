import type { AssetSummary } from '../../shared/asset-types';
import type { AssetDetail } from './api';
import { downloadUrl } from './api';
import { formatBytes, formatDate, formatDimensions, formatDuration, stars } from './format';
import { t } from './i18n';

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
  onClose,
}: {
  libraryId: string;
  summary: AssetSummary;
  detail: AssetDetail | null;
  allowDownload: boolean;
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
  const rating = metadata?.rating ?? summary.rating;
  const favorite = metadata?.favorite ?? summary.favorite;
  const tags = metadata?.tags ?? [];

  return (
    <aside className="detail" aria-label={t('资产详情', 'Asset details')}>
      <div className="detail-actions">
        <button className="button ghost" type="button" onClick={onClose}>
          {t('收起', 'Hide')}
        </button>
        {allowDownload ? (
          <a className="button" href={downloadUrl(libraryId, summary)} download>
            {t('下载原图', 'Download')}
          </a>
        ) : null}
      </div>

      <h2>{summary.displayName}</h2>

      <section className="detail-section">
        <h3>{t('信息', 'Info')}</h3>
        <dl>
          <dt>{t('类型', 'Type')}</dt>
          <dd>{summary.mediaType}</dd>
          <dt>{t('尺寸', 'Dimensions')}</dt>
          <dd>{formatDimensions(summary.width, summary.height)}</dd>
          <dt>{t('大小', 'Size')}</dt>
          <dd>{formatBytes(summary.byteSize)}</dd>
          {summary.durationMs !== null && summary.durationMs !== undefined && summary.durationMs > 0 ? (
            <>
              <dt>{t('时长', 'Duration')}</dt>
              <dd>{formatDuration(summary.durationMs)}</dd>
            </>
          ) : null}
          <dt>{t('修改时间', 'Modified')}</dt>
          <dd>{formatDate(summary.modifiedAt)}</dd>
          <dt>{t('路径', 'Path')}</dt>
          <dd>{summary.relativeFilePath}</dd>
        </dl>
      </section>

      <section className="detail-section">
        <h3>{t('评分与标记', 'Rating & flags')}</h3>
        <dl>
          <dt>{t('评分', 'Rating')}</dt>
          <dd className="stars">{stars(rating)}</dd>
          <dt>{t('喜欢', 'Favorite')}</dt>
          <dd>{favorite ? t('是', 'Yes') : t('否', 'No')}</dd>
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
