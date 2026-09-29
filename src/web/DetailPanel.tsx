import type { AssetDetail } from './api';
import { downloadUrl } from './api';
import { formatBytes, formatDate, formatDimensions, formatDuration, stars } from './format';
import { t } from './i18n';

function stringField(metadata: Record<string, unknown> | null, key: string): string | null {
  if (metadata === null) return null;
  const value = metadata[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function DetailPanel({
  libraryId,
  detail,
  allowDownload,
  onClose,
}: {
  libraryId: string;
  detail: AssetDetail;
  allowDownload: boolean;
  onClose: () => void;
}) {
  const { asset, metadata, extracted } = detail;
  const camera = [
    stringField(extracted.metadata, 'cameraMake'),
    stringField(extracted.metadata, 'cameraModel'),
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
  const author = metadata.author ?? stringField(extracted.metadata, 'author');
  const captureDate = stringField(extracted.metadata, 'captureDate');

  return (
    <aside className="detail" aria-label={t('资产详情', 'Asset details')}>
      <div className="detail-actions">
        <button className="button ghost" type="button" onClick={onClose}>
          {t('收起', 'Hide')}
        </button>
        {allowDownload ? (
          <a className="button" href={downloadUrl(libraryId, asset)} download>
            {t('下载原图', 'Download')}
          </a>
        ) : null}
      </div>

      <h2>{asset.displayName}</h2>

      <section className="detail-section">
        <h3>{t('信息', 'Info')}</h3>
        <dl>
          <dt>{t('类型', 'Type')}</dt>
          <dd>{asset.mediaType}</dd>
          <dt>{t('尺寸', 'Dimensions')}</dt>
          <dd>{formatDimensions(asset.width, asset.height)}</dd>
          <dt>{t('大小', 'Size')}</dt>
          <dd>{formatBytes(asset.byteSize)}</dd>
          {asset.durationMs !== null && asset.durationMs !== undefined && asset.durationMs > 0 ? (
            <>
              <dt>{t('时长', 'Duration')}</dt>
              <dd>{formatDuration(asset.durationMs)}</dd>
            </>
          ) : null}
          <dt>{t('修改时间', 'Modified')}</dt>
          <dd>{formatDate(asset.modifiedAt)}</dd>
          <dt>{t('路径', 'Path')}</dt>
          <dd>{asset.relativeFilePath}</dd>
        </dl>
      </section>

      <section className="detail-section">
        <h3>{t('评分与标记', 'Rating & flags')}</h3>
        <dl>
          <dt>{t('评分', 'Rating')}</dt>
          <dd className="stars">{stars(metadata.rating)}</dd>
          <dt>{t('喜欢', 'Favorite')}</dt>
          <dd>{metadata.favorite ? t('是', 'Yes') : t('否', 'No')}</dd>
        </dl>
      </section>

      {metadata.tags.length > 0 ? (
        <section className="detail-section">
          <h3>{t('标签', 'Tags')}</h3>
          <div className="chips">
            {metadata.tags.map((tag) => (
              <span className="chip" key={tag.id}>
                {tag.name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {metadata.description !== null && metadata.description !== '' ? (
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

      {metadata.sourcePageUrl !== null && metadata.sourcePageUrl !== '' ? (
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
