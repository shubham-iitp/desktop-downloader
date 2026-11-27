import { useState } from 'react';
import type { Density, Job, Tab } from '@shared/types';
import { tabOf } from '@shared/types';
import { formatBytes, formatEta, formatSpeed } from '@shared/limits';
import { Folder, PauseIcon, Play, Close, Retry, Trash } from '../icons';

interface Props {
  tab: Tab;
  jobs: Job[];
  density: Density;
  onRemove: (job: Job) => void;
  /** A captured link expired: open the Videos panel on the page it came from. */
  onFetchAgain: (url: string) => void;
}

/** The queue for one tab. Runs top to bottom. */
export function Queue({ tab, jobs, density, onRemove, onFetchAgain }: Props) {
  const videos = tab === 'videos';
  let rows = jobs.filter((j) => tabOf(j.kind) === tab);
  // Captured links expire within hours, so unfinished captured jobs sit (and run) at the top.
  if (videos) rows = [...rows.filter(capturedFirst), ...rows.filter((j) => !capturedFirst(j))];
  const done = rows.filter((j) => j.status === 'completed').length;
  // Queue positions: aria2's slots are shared by the Torrent and Normal tabs; yt-dlp has its own 3.
  const queuedOrder = (videos ? rows.filter((j) => j.engine === 'ytdlp') : jobs.filter((j) => j.engine !== 'ytdlp'))
    .filter((j) => j.status === 'queued')
    .map((j) => j.id);

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
          {videos ? 'Nothing here yet. Fetch videos from a page on the right to start.' : 'Nothing here yet. Paste a link on the right to start.'}
        </div>
      )}
      {rows.map((j) => (
        <JobRow
          key={j.id}
          job={j}
          queuePos={queuedOrder.indexOf(j.id) + 1}
          compact={density === 'compact'}
          onRemove={() => onRemove(j)}
          onFetchAgain={() => onFetchAgain(j.media?.pageUrl ?? j.url)}
        />
      ))}
    </>
  );
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--run)',
  postprocessing: 'var(--run)',
  queued: 'var(--muted)',
  paused: 'var(--warn)',
  completed: 'var(--ok)',
  error: 'var(--err)',
  probing: 'var(--muted)',
  cancelled: 'var(--muted)'
};

const capturedFirst = (j: Job) => j.media?.source === 'captured' && j.status !== 'completed';

function JobRow({
  job: j,
  queuePos,
  compact,
  onRemove,
  onFetchAgain
}: {
  job: Job;
  queuePos: number;
  compact: boolean;
  onRemove: () => void;
  onFetchAgain: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const torrent = j.kind === 'torrent';
  const ytdlp = j.engine === 'ytdlp';
  const expired = j.status === 'error' && j.error?.code === 'LINK_EXPIRED' && !/fetching/i.test(j.error.message);
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
        : st === 'postprocessing'
          ? 'Processing'
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
          // aria2's `connections` = peers connected right now; numSeeders = those that have the whole file.
          torrent && known ? `${j.peers ?? 0} connected (${j.seeders ?? 0} seeding)` : '',
          torrent && j.uploadSpeed ? `↑ ${formatSpeed(j.uploadSpeed)}` : ''
        ]
          .filter(Boolean)
          .join('  ·  ')
      : st === 'postprocessing'
        ? `${j.postNote ?? 'Processing…'}  ·  ffmpeg`
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
    j.kind === 'media'
      ? [j.host, j.media?.source === 'captured' ? 'captured' : '', ytdlp ? 'yt-dlp' : 'aria2c'].filter(Boolean).join(' · ')
      : !torrent
        ? [j.host, j.kind === 'metalink' ? 'Metalink' : j.resumable ? 'Resumable' : 'No resume'].filter(Boolean).join(' · ')
        : j.selectionNote
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
        <div style={{ width: `${st === 'postprocessing' ? 100 : pct}%`, background: col, opacity: st === 'postprocessing' ? 0.55 : undefined }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: st === 'error' ? 'var(--err)' : 'var(--muted)' }}>{detail}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {st !== 'completed' && !ytdlp && (
            <>
              <span className="muted" style={{ fontSize: 12 }}>
                {torrent ? 'Max peers' : 'Connections'}
              </span>
              <div className="stepper">
                <button
                  aria-label={torrent ? 'Lower max peers' : 'Fewer connections'}
                  disabled={j.connections <= lo}
                  onClick={() => void window.dl.setConnections(j.id, Math.max(lo, j.connections - step))}
                >
                  −
                </button>
                <span>{j.connections}</span>
                <button
                  aria-label={torrent ? 'Raise max peers' : 'More connections'}
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
              <button
                className="btn"
                onClick={() => (expired ? onFetchAgain() : void window.dl.retry(j.id))}
                style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600 }}
              >
                <Retry />
                {expired ? 'Fetch again' : 'Retry'}
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
            title="Remove…"
            onClick={onRemove}
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
