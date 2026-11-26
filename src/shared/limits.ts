import type { SpeedLimit } from './types';

/**
 * Maps a speed limit from the Settings slider (KB/s, -1 = unlimited) to an aria2 option value.
 * aria2 treats 0 as "no limit", so the lowest real cap the UI offers is 1 KB/s.
 */
export function toAria2Limit(limit: SpeedLimit): string {
  if (!Number.isFinite(limit) || limit < 0) return '0';
  if (limit < 1000) return `${Math.max(1, Math.round(limit))}K`;
  return `${Math.round(limit / 1000)}M`;
}

export function formatLimit(limit: SpeedLimit): string {
  if (limit < 0) return 'Unlimited';
  if (limit < 1000) return `${Math.max(1, Math.round(limit))} KB/s`;
  return `${Math.round(limit / 1000)} MB/s`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export function formatEta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.ceil(sec)} s left`;
  if (sec < 3600) return `${Math.ceil(sec / 60)} min left`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h} h ${m} min left`;
}
