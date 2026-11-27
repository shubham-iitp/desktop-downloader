import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Magnet, WinClose } from '../icons';

/**
 * First open of a fresh install: "Open magnet links with Downloader?" with an optional
 * "Also open .torrent files". Asked once; Settings › General changes it later.
 */
export function FirstRunDialog({ torrentSupported, onAnswer }: { torrentSupported: boolean; onAnswer: (yes: boolean, torrent: boolean) => void }) {
  const [torrent, setTorrent] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAnswer(false, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  return (
    <div className="overlay">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="fr-title" aria-describedby="fr-desc" className="dialog" style={{ width: 480, outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div
              style={{
                flex: 'none',
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'var(--accent)',
                color: 'var(--accentText)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Magnet size={18} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Welcome to Downloader
              </div>
              <h2 id="fr-title" style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 700 }}>
                Open magnet links with Downloader?
              </h2>
            </div>
          </div>
          <button aria-label="Not now" onClick={() => onAnswer(false, false)} className="x-btn">
            <WinClose w={1.4} />
          </button>
        </div>
        <div id="fr-desc" className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
          When you click a magnet link in your browser, it opens here and goes straight to the Torrent tab, ready to start.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 10, background: 'var(--panel2)', border: '1px solid var(--line)' }}>
          <div className="mono muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            magnet:?xt=urn:btih:3b245504cf5f11bbdbe1201cea6a6bf45aee1bc0&amp;dn=ubuntu-24.04.3…
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span className="muted" style={{ display: 'inline-flex' }}>
              <ArrowRight />
            </span>
            <span>
              Opens in <b>Downloader</b> · Torrent tab
            </span>
          </div>
        </div>
        {torrentSupported && (
          <button
            role="checkbox"
            aria-checked={torrent}
            onClick={() => setTorrent((t) => !t)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 0, border: 0, background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
          >
            <span
              style={{
                flex: 'none',
                width: 18,
                height: 18,
                borderRadius: 5,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accentText)',
                ...(torrent ? { background: 'var(--accent)', border: 0 } : { background: 'transparent', border: '2px solid var(--muted)' })
              }}
            >
              <span style={{ display: 'inline-flex', visibility: torrent ? 'visible' : 'hidden' }}>
                <Check size={11} strokeWidth={3.4} />
              </span>
            </span>
            <span>
              Also open <b>.torrent</b> files with Downloader
            </span>
          </button>
        )}
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: -4 }}>
          Asked once. You can change it anytime in Settings › General.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, paddingTop: 4 }}>
          <button className="btn" onClick={() => onAnswer(false, false)} style={{ height: 44, width: '100%', borderRadius: 10, fontWeight: 600 }}>
            Not now
          </button>
          <button className="btn-primary" onClick={() => onAnswer(true, torrentSupported && torrent)} style={{ height: 44, width: '100%' }}>
            Make default
          </button>
        </div>
      </div>
    </div>
  );
}

/** After Make default: confirmation (or, if Windows kept another app, what to do in Default apps). */
export function FirstRunToast({ torrent, blocked, onSettings, onDismiss }: { torrent: boolean; blocked: boolean; onSettings: () => void; onDismiss: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        top: 20,
        right: 20,
        zIndex: 40,
        width: 380,
        maxWidth: 'calc(100% - 40px)',
        boxSizing: 'border-box',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        boxShadow: '0 16px 40px rgba(0,0,0,0.3)',
        padding: 14,
        display: 'flex',
        gap: 12
      }}
    >
      <div
        style={{
          flex: 'none',
          width: 36,
          height: 36,
          borderRadius: 9,
          background: blocked ? 'var(--warn)' : 'var(--ok)',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {blocked ? <Magnet size={18} /> : <Check size={18} strokeWidth={2.6} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{blocked ? 'Windows needs you to confirm this' : 'Downloader is now your torrent app'}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
          {blocked
            ? 'Another app was picked in Windows Settings › Default apps, which apps can’t change. It’s open now: choose Desktop Downloader there.'
            : torrent
              ? 'Magnet links and .torrent files now open in the Torrent tab. You can change this in Settings › General.'
              : 'Magnet links now open in the Torrent tab. You can change this in Settings › General.'}
        </div>
        <button
          onClick={onSettings}
          style={{ marginTop: 8, padding: 0, border: 0, background: 'transparent', fontSize: 12, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer' }}
        >
          Open Settings
        </button>
      </div>
      <button aria-label="Dismiss notification" onClick={onDismiss} className="x-btn" style={{ width: 26, height: 26, margin: 0 }}>
        <WinClose />
      </button>
    </div>
  );
}
