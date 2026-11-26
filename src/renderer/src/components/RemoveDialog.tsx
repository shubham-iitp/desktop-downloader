import { useEffect, useRef, useState } from 'react';
import type { Job } from '@shared/types';
import { formatBytes } from '@shared/limits';
import { FileIcon, WinClose } from '../icons';

interface Props {
  job: Job;
  onClose: () => void;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

/**
 * The × on a queue row: "Remove from list" keeps what's on disk;
 * "Delete (partial) file" also moves it to the Recycle Bin. Esc or the × close it without changes.
 */
export function RemoveDialog({ job: j, onClose }: Props) {
  // Focus the dialog, not a button: no stray focus ring, and Enter can't trigger a choice by accident.
  const first = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = j.status === 'completed';
  const known = j.totalBytes != null && j.totalBytes > 0;
  const pct = known ? Math.floor((j.doneBytes / j.totalBytes!) * 100) : 0;
  const size = known ? formatBytes(j.totalBytes) : 'unknown size';
  const partial = !done && j.doneBytes > 0;
  const torrent = j.kind === 'torrent';
  const many = torrent && (j.torrentFiles?.length ?? j.files.length) > 1;
  const noun = many ? 'files' : 'file';

  const status = done
    ? `Completed · ${formatBytes(j.totalBytes ?? j.doneBytes)}`
    : j.status === 'error'
      ? partial
        ? `Failed · ${formatBytes(j.doneBytes)} saved`
        : 'Failed · nothing saved yet'
      : j.status === 'paused'
        ? `Paused at ${known ? `${pct}% of ${size}` : formatBytes(j.doneBytes)}`
        : j.status === 'active' && partial
          ? `Downloading · ${known ? `${pct}% of ${size}` : formatBytes(j.doneBytes)}`
          : 'Queued · not started';
  const path = !torrent && j.files[0] ? j.files[0] : joinPath(j.dir, torrent ? j.title : (j.outName ?? j.title));
  const deleteLabel = done ? `Delete ${noun}` : `Delete partial ${noun}`;
  const keepText = done
    ? `keeps the ${noun} where ${many ? 'they are' : 'it is'}.`
    : partial
      ? `stops it and keeps the partial ${noun}, so you can add the link again and resume.`
      : 'stops it. Nothing has been saved yet.';
  const deleteText = done
    ? `also moves the ${noun} to the Recycle Bin${torrent ? ', including any unselected files the torrent created' : ''}.`
    : `also moves what was downloaded so far, and its .aria2 resume file, to the Recycle Bin${torrent ? ', including any unselected files the torrent created' : ''}.`;
  const tone = done ? 'var(--ok)' : 'var(--run)';

  const act = async (deleteFiles: boolean) => {
    setBusy(true);
    await window.dl.cancel(j.id, deleteFiles);
    onClose();
  };

  return (
    <div className="overlay">
      <div ref={first} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="remove-title" className="dialog" style={{ width: 480, outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h2 id="remove-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {done ? 'Remove this download?' : 'Stop and remove this download?'}
          </h2>
          <button
            aria-label="Cancel"
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              margin: '-4px -6px 0 0',
              border: 0,
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <WinClose w={1.4} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: 'var(--panel2)', border: '1px solid var(--line)' }}>
          <div
            style={{
              flex: 'none',
              width: 32,
              height: 32,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: tone,
              border: `1px solid ${tone}`
            }}
          >
            <FileIcon size={16} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.title}>
              {j.title}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {status}
            </div>
            <div className="mono muted" style={{ fontSize: 11.5, marginTop: 4, overflowWrap: 'anywhere' }}>
              {path}
            </div>
          </div>
        </div>
        <div className="muted" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5 }}>
          <div>
            <b style={{ color: 'var(--text)' }}>Remove from list</b> {keepText}
          </div>
          <div>
            <b style={{ color: 'var(--text)' }}>{deleteLabel}</b> {deleteText}
          </div>
        </div>
        {/* Two equal full-width actions (Final Version). Esc and the × above cancel. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, paddingTop: 4 }}>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void act(false)}
            style={{ height: 44, width: '100%', padding: '0 12px', borderRadius: 10, fontWeight: 600 }}
          >
            Remove from list
          </button>
          <button
            disabled={busy}
            onClick={() => void act(true)}
            style={{
              height: 44,
              width: '100%',
              padding: '0 12px',
              border: 0,
              borderRadius: 10,
              background: 'var(--err)',
              color: '#FFFFFF',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {deleteLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
