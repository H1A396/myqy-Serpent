import { useEffect, useState } from 'react';

import { t } from './i18n';
import { prefetchQueue, type PrefetchProgress } from './prefetch-queue';

const IDLE: PrefetchProgress = { images: 0, total: 0, completed: 0, tier: null, active: false };

/**
 * Per-tier completion, derived from the queue's strict "whole low tier, then
 * whole high tier" order: the first `images` completions are all low tier.
 */
export function tierCompletion(progress: PrefetchProgress): { low: number; high: number } {
  return {
    low: Math.min(progress.completed, progress.images),
    high: Math.max(0, progress.completed - progress.images),
  };
}

function TierBar({
  label,
  done,
  total,
  current,
}: {
  label: string;
  done: number;
  total: number;
  current: boolean;
}) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className="prefetch-tier" data-active={current}>
      <span className="prefetch-tier-label">{label}</span>
      <span
        aria-label={t(`WebP ${label} 后台缓存`, `WebP ${label} background cache`)}
        aria-valuemax={total}
        aria-valuemin={0}
        aria-valuenow={done}
        className="prefetch-tier-bar"
        role="progressbar"
      >
        <span className="prefetch-tier-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="prefetch-tier-count">
        {done}/{total}
      </span>
    </span>
  );
}

/**
 * Toolbar indicator for the background viewer-image prefetch. It subscribes to
 * the shared queue and hides itself while idle or once both tiers are cached.
 */
export function PrefetchIndicator() {
  const [progress, setProgress] = useState<PrefetchProgress>(IDLE);

  useEffect(() => {
    const unsubscribe = prefetchQueue.subscribe(setProgress);
    return () => {
      unsubscribe();
    };
  }, []);

  if (progress.total === 0) return null;
  if (!progress.active && progress.completed >= progress.total) return null;
  const { low, high } = tierCompletion(progress);

  return (
    <span
      aria-label={t('后台自动缓存进度', 'Background caching progress')}
      className="prefetch-indicator"
      role="group"
    >
      <span className="prefetch-label">{t('自动缓存', 'Auto cache')}</span>
      <TierBar current={progress.tier === 'low'} done={low} label="82" total={progress.images} />
      <TierBar current={progress.tier === 'high'} done={high} label="100" total={progress.images} />
    </span>
  );
}
