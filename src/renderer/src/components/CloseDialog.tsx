import { useEffect, useRef } from 'react';
import type { CloseChoice } from '@shared/types';
import { DownloadGlyph, WinClose } from '../icons';

interface Props {
  active: number;
  queued: number;
  onChoice: (c: CloseChoice) => void;
}

/** "Close Downloader?" — Hide to tray / Quit / Cancel. Esc and × cancel. */
export function CloseDialog({ active, queued, onChoice }: Props) {
  const primary = useRef<HTMLButtonElement>(null);
  const n = active + queued;

  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChoice('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoice]);

  const running = n > 0;
  return (
    <div className="overlay">
      <div role="dialog" aria-modal="true" aria-labelledby="close-title" className="dialog">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h2 id="close-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Close Downloader?
          </h2>
          <button
            aria-label="Cancel"
            onClick={() => onChoice('cancel')}
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
              color: running ? 'var(--run)' : 'var(--muted)',
              border: `1px solid ${running ? 'var(--run)' : 'var(--line)'}`
            }}
          >
            <DownloadGlyph />
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>
              {running ? `${active} download${active === 1 ? '' : 's'} running${queued ? `, ${queued} queued` : ''}` : 'Nothing is downloading'}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {running ? `Quit will pause ${n === 1 ? 'it' : 'them'} until you open Downloader again.` : 'You can quit without interrupting anything.'}
            </div>
          </div>
        </div>
        <div className="muted" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5 }}>
          <div>
            <b style={{ color: 'var(--text)' }}>Hide to tray</b> keeps downloads running in the background.
          </div>
          <div>
            <b style={{ color: 'var(--text)' }}>Quit</b> saves the session and stops the engine. Active downloads resume next time you open Downloader.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
          <button className="btn" onClick={() => onChoice('cancel')} style={{ height: 40, padding: '0 14px', fontWeight: 500, borderColor: 'transparent', background: 'transparent' }}>
            Cancel
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Esc
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => onChoice('quit')} style={{ height: 40, padding: '0 16px', fontWeight: 600 }}>
            Quit
          </button>
          <button ref={primary} className="btn-primary" onClick={() => onChoice('hide')} style={{ height: 40, padding: '0 18px' }}>
            Hide to tray
          </button>
        </div>
      </div>
    </div>
  );
}
