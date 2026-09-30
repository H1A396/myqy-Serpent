export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);
  return `${rounded} ${units[unit]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function formatDimensions(width: number | null, height: number | null): string {
  if (width === null || height === null) return '—';
  return `${width} × ${height}`;
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || durationMs <= 0) return '—';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function stars(rating: number): string {
  return '★★★★★'.slice(0, Math.max(0, Math.min(5, rating))) + '☆☆☆☆☆'.slice(0, 5 - Math.max(0, Math.min(5, rating)));
}

const MEDIA_TYPE_LABELS: Readonly<Record<string, [string, string]>> = {
  image: ['图片', 'Image'],
  video: ['视频', 'Video'],
  audio: ['音频', 'Audio'],
  text: ['文本', 'Text'],
  model: ['模型', '3D model'],
  document: ['文档', 'Document'],
  font: ['字体', 'Font'],
  other: ['其他', 'Other'],
};

/** Localized media-type label; falls back to the raw value for unknowns. */
export function mediaTypeLabel(mediaType: string, zh: boolean): string {
  const labels = MEDIA_TYPE_LABELS[mediaType];
  if (labels === undefined) return mediaType;
  return zh ? labels[0] : labels[1];
}

/**
 * Keep the head and tail of a long name with the extension visible, so two
 * files that differ only in a middle hash are still distinguishable.
 * `Krea2-文生图_00070.png` stays intact; longer names retain the extension.
 */
export function truncateMiddle(name: string, maxChars = 22): string {
  if (name.length <= maxChars) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const stem = extension === '' ? name : name.slice(0, dot);
  const available = Math.max(8, maxChars - extension.length - 1);
  const head = Math.min(9, Math.ceil(available / 2));
  const tail = Math.max(4, available - head);
  return `${stem.slice(0, head)}…${stem.slice(-tail)}${extension}`;
}
