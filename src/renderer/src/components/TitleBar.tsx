import { useCallback, useState } from 'react';
import { Gear, Logo, WinClose, WinMax, WinMin } from '../icons';
import { useDismiss } from '../hooks';

interface Props {
  isMac: boolean;
  title: string;
  withFileMenu?: boolean;
  onSettings?: () => void;
  onOpenTorrent?: () => void;
}

/** Custom title bar from the design: logo, File menu, Settings, window controls. */
export function TitleBar({ isMac, title, withFileMenu, onSettings, onOpenTorrent }: Props) {
  const [fileOpen, setFileOpen] = useState(false);
  const close = useCallback(() => setFileOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(fileOpen, close);

  return (
    <div className={`titlebar${isMac ? ' mac' : ''}`} onDoubleClick={(e) => e.target === e.currentTarget && window.dl.toggleMaximize()}>
      <div className="brand">
        <Logo />
        {title}
        {withFileMenu && !isMac && (
          <div ref={ref} style={{ position: 'relative', marginLeft: 8 }}>
            <button
              aria-haspopup="menu"
              aria-expanded={fileOpen}
              onClick={() => setFileOpen((o) => !o)}
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 6,
                border: 0,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                color: 'var(--text)',
                background: fileOpen ? 'var(--panel2)' : 'transparent'
              }}
            >
              File
            </button>
            {fileOpen && (
              <div role="menu" className="menu" style={{ left: 0, top: 32 }}>
                <button role="menuitem" className="menu-item" onClick={() => (close(), onOpenTorrent?.())}>
                  <span>Open .torrent file…</span>
                  <span className="muted">Ctrl+O</span>
                </button>
                <button role="menuitem" className="menu-item" onClick={() => (close(), onSettings?.())}>
                  <span>Settings…</span>
                  <span className="muted">Ctrl+,</span>
                </button>
                <div className="menu-sep" />
                <button role="menuitem" className="menu-item" onClick={() => void window.dl.quit()}>
                  <span>Quit Downloader</span>
                  <span className="muted">Ctrl+Q</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: isMac ? 12 : 0 }}>
        {onSettings && (
          <button
            className="btn"
            onClick={onSettings}
            aria-label="Settings"
            title="Settings"
            style={{ height: 28, padding: '0 10px', fontSize: 12, fontWeight: 600 }}
          >
            <Gear />
            Settings
          </button>
        )}
        {!isMac && (
          <div className="winctl">
            <button aria-label="Minimize" onClick={() => void window.dl.minimize()}>
              <WinMin />
            </button>
            <button aria-label="Maximize" onClick={() => void window.dl.toggleMaximize()}>
              <WinMax />
            </button>
            <button className="close" aria-label="Close window" title="Close" onClick={() => void window.dl.closeWindow()}>
              <WinClose />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
