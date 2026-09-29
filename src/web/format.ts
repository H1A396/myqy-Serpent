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
