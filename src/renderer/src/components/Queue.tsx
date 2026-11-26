import { useState } from 'react';
import type { Density, Job, Tab } from '@shared/types';
import { tabOf } from '@shared/types';
import { formatBytes, formatEta, formatSpeed } from '@shared/limits';
import { Folder, PauseIcon, Play, Close, Retry, Trash } from '../icons';

interface Props {
  tab: Tab;
  jobs: Job[];
  density: Density;
}

/** The queue for one tab. Runs top to bottom. */
export function Queue({ tab, jobs, density }: Props) {
  const rows = jobs.filter((j) => tabOf(j.kind) === tab);
  const done = rows.filter((j) => j.status === 'completed').length;
  // Queue positions are global: aria2's slots are shared by both tabs.
  const queuedOrder = jobs.filter((j) => j.status === 'queued').map((j) => j.id);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 className="section-title">Queue</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            Runs top to bottom
          </span>
        </div>
        <button
          className="btn"
          disabled={done === 0}
          onClick={() => void window.dl.clearCompleted(tab)}
          style={{ height: 32, gap: 8, padding: '0 12px', fontSize: 13, fontWeight: 500 }}
        >
          <Trash />
          Clear completed ({done})
        </button>
      </div>
      {rows.length === 0 && (
        <div
          className="muted"
          style={{ padding: '48px 24px', textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 12 }}
        >
          Nothing here yet. Paste a link on the right to start.
        </div>
      )}
      {rows.map((j) => (
        <JobRow key={j.id} job={j} queuePos={queuedOrder.indexOf(j.id) + 1} compact={density === 'compact'} />
      ))}
    </>
  );
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--run)',
  queued: 'var(--muted)',
  paused: 'var(--warn)',
  completed: 'var(--ok)',
  error: 'var(--err)',
  probing: 'var(--muted)',
  cancelled: 'var(--muted)'
};

function JobRow({ job: j, queuePos, compact }: { job: Job; queuePos: number; compact: boolean }) {
  const [copied, setCopied] = useState(false);
  const torrent = j.kind === 'torrent';
  const st = j.status;
  const col = STATUS_COLOR[st];
  const known = j.totalBytes != null && j.totalBytes > 0;
  const pct = known ? Math.min(100, Math.floor((j.doneBytes / j.totalBytes!) * 100)) : st === 'completed' ? 100 : 0;
  const seeding = st === 'completed' && j.uploadSpeed > 0;

  const label =
    st === 'queued'
      ? `Queued · #${queuePos || 1}`
      : st === 'active'
        ? 'Downloading'
        : st === 'paused'
          ? 'Paused'
          : st === 'completed'
            ? seeding
              ? 'Seeding'
              : 'Completed'
            : st === 'error'
              ? 'Failed'
              : st;

  const progress = known ? `${pct}%` : formatBytes(j.doneBytes);
  const detail =
    st === 'active'
      ? [
          progress,
          j.speed ? formatSpeed(j.speed) : torrent ? (known ? 'Connecting to peers…' : 'Fetching metadata…') : 'Connecting…',
          formatEta(j.eta),
          torrent && j.peers ? `${j.peers} peers` : '',
          torrent && j.uploadSpeed ? `↑ ${formatSpeed(j.uploadSpeed)}` : ''
        ]
          .filter(Boolean)
          .join('  ·  ')
      : st === 'queued'
        ? queuePos <= 1
          ? 'Next in line · starts when a slot frees up'
          : `Position ${queuePos} in queue · ${queuePos - 1} ahead of it`
        : st === 'paused'
          ? `${progress} · paused${j.resumable ? '' : ' · resuming restarts from 0'}`
          : st === 'error'
            ? (j.error?.message ?? 'Download failed')
            : seeding
              ? `Finished · seeding ↑ ${formatSpeed(j.uploadSpeed)}`
              : 'Finished · file is ready';

  const meta = [
    known ? formatBytes(j.totalBytes) : st === 'completed' ? formatBytes(j.doneBytes) : 'Size unknown',
    !torrent ? [j.host, j.kind === 'metalink' ? 'Metalink' : j.resumable ? 'Resumable' : 'No resume'].filter(Boolean).join(' · ') : j.selectionNote
  ]
    .filter(Boolean)
    .join('  ·  ');

  const path = j.files.length === 1 || !torrent ? (j.files[0] ?? joinPath(j.dir, j.outName ?? j.title)) : joinPath(j.dir, j.title);
  const lo = torrent ? 5 : 1;
  const hi = torrent ? 200 : j.resumable ? 16 : 1;
  const step = torrent ? 5 : 1;
  const canPause = st === 'active' || st === 'queued' || st === 'paused';

  const copy = () => {
    void navigator.clipboard.writeText(`${j.title}: ${j.error?.message ?? ''}\n${j.url}\n${j.error?.detail ?? ''}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`row${compact ? ' compact' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.title}>
            {j.title}
          </div>
          {!compact && (
            <>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {meta}
              </div>
              <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, minWidth: 0 }}>
                <Folder size={13} style={{ flex: 'none' }} />
                <span title={path} className="mono" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {path}
                </span>
              </div>
            </>
          )}
        </div>
        <span className="badge" style={{ color: col }}>
          {label}
        </span>
      </div>
      <div className={`bar${st === 'active' && !known ? ' indeterminate' : ''}`}>
        <div style={{ width: `${pct}%`, background: col }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: st === 'error' ? 'var(--err)' : 'var(--muted)' }}>{detail}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {st !== 'completed' && (
            <>
              <span className="muted" style={{ fontSize: 12 }}>
                {torrent ? 'Peers' : 'Connections'}
              </span>
              <div className="stepper">
                <button
                  aria-label={torrent ? 'Fewer peers' : 'Fewer connections'}
                  disabled={j.connections <= lo}
                  onClick={() => void window.dl.setConnections(j.id, Math.max(lo, j.connections - step))}
                >
                  −
                </button>
                <span>{j.connections}</span>
                <button
                  aria-label={torrent ? 'More peers' : 'More connections'}
                  disabled={j.connections >= hi}
                  onClick={() => void window.dl.setConnections(j.id, Math.min(hi, j.connections + step))}
                >
                  +
                </button>
              </div>
            </>
          )}
          {st === 'error' && (
            <>
              <button className="btn" onClick={copy} style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 500 }}>
                {copied ? 'Copied' : 'Copy details'}
              </button>
              <button className="btn" onClick={() => void window.dl.retry(j.id)} style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600 }}>
                <Retry />
                Retry
              </button>
            </>
          )}
          {canPause && (
            <button
              className="btn icon-btn"
              aria-label={st === 'paused' ? 'Resume' : 'Pause'}
              title={st === 'paused' ? 'Resume' : 'Pause'}
              onClick={() => void (st === 'paused' ? window.dl.resume(j.id) : window.dl.pause(j.id))}
            >
              {st === 'paused' ? <Play /> : <PauseIcon />}
            </button>
          )}
          <button className="btn icon-btn" aria-label="Open containing folder" title="Open folder" onClick={() => void window.dl.reveal(j.id)}>
            <Folder />
          </button>
          <button
            className="btn icon-btn"
            aria-label="Remove from queue"
            title={st === 'completed' ? 'Remove from list (keeps the file)' : 'Cancel and delete the partial file'}
            onClick={() => void window.dl.cancel(j.id, st !== 'completed')}
          >
            <Close />
          </button>
        </div>
      </div>
    </div>
  );
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}
