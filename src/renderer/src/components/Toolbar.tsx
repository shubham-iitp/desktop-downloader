import type { CSSProperties } from 'react';
import type { Tab } from '@shared/types';
import { LinkIcon, Magnet, Minus, Plus } from '../icons';

interface Props {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: { active: number; queued: number; torrent: number; normal: number };
  parallel: number;
  setParallel: (n: number) => void;
}

const tabStyle = (on: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 16px',
  border: 0,
  borderRadius: 7,
  fontWeight: 600,
  cursor: 'pointer',
  background: on ? 'var(--accent)' : 'transparent',
  color: on ? 'var(--accentText)' : 'var(--muted)'
});

/** Torrent / Normal tabs, slot summary and the Parallel downloads stepper. */
export function Toolbar({ tab, setTab, counts, parallel, setParallel }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '16px 24px',
        borderBottom: '1px solid var(--line)',
        flex: 'none'
      }}
    >
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10 }}>
        <button role="tab" aria-selected={tab === 'torrent'} onClick={() => setTab('torrent')} style={tabStyle(tab === 'torrent')}>
          <Magnet />
          Torrent <span style={{ opacity: 0.75, fontWeight: 500 }}>{counts.torrent}</span>
        </button>
        <button role="tab" aria-selected={tab === 'normal'} onClick={() => setTab('normal')} style={tabStyle(tab === 'normal')}>
          <LinkIcon />
          Normal <span style={{ opacity: 0.75, fontWeight: 500 }}>{counts.normal}</span>
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {Math.min(counts.active, parallel)} of {parallel} slots busy · {counts.queued} waiting
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 6px 6px 14px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10
          }}
        >
          <span style={{ fontWeight: 500 }}>Parallel downloads</span>
          <button
            className="btn"
            aria-label="Fewer parallel downloads"
            disabled={parallel <= 1}
            onClick={() => setParallel(Math.max(1, parallel - 1))}
            style={{ width: 32, height: 32 }}
          >
            <Minus />
          </button>
          <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700, fontSize: 16 }}>{parallel}</span>
          <button
            className="btn"
            aria-label="More parallel downloads"
            disabled={parallel >= 10}
            onClick={() => setParallel(Math.min(10, parallel + 1))}
            style={{ width: 32, height: 32 }}
          >
            <Plus />
          </button>
        </div>
      </div>
    </div>
  );
}
