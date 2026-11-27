import type { CSSProperties } from 'react';
import type { Tab } from '@shared/types';
import { LinkIcon, Magnet, VideoIcon } from '../icons';

interface Props {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: { active: number; queued: number; torrent: number; normal: number; videos: number; videoActive: number; videoQueued: number };
  parallel: number;
}

/** yt-dlp video jobs that run at once (main/ytdlp/runner.ts). */
const VIDEO_SLOTS = 3;

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

/** Torrent / Normal / Videos tabs and the slot summary. */
export function Toolbar({ tab, setTab, counts, parallel }: Props) {
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
        <button role="tab" aria-selected={tab === 'videos'} onClick={() => setTab('videos')} style={tabStyle(tab === 'videos')}>
          <VideoIcon />
          Videos <span style={{ opacity: 0.75, fontWeight: 500 }}>{counts.videos}</span>
        </button>
      </div>
      {/* Parallel downloads is set in Settings › Downloads & folders (Final Version design). */}
      <span className="muted" style={{ fontSize: 13 }}>
        {tab === 'videos'
          ? `${Math.min(counts.videoActive, VIDEO_SLOTS)} of ${VIDEO_SLOTS} video slots busy · ${counts.videoQueued} waiting`
          : `${Math.min(counts.active, parallel)} of ${parallel} slots busy · ${counts.queued} waiting`}
      </span>
    </div>
  );
}
