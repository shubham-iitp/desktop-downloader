import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { Browser, CaptureUpdate, Settings } from '@shared/types';
import { Chevron, Clipboard, Folder, VideoIcon, WinClose } from '../icons';
import { useDismiss } from '../hooks';

interface Props {
  settings: Settings;
  capture: CaptureUpdate | null;
  /** Kept by App so switching tabs doesn't clear them. */
  link: string;
  setLink: (v: string) => void;
  /** Browser picked for this fetch ('' = the default from Settings). */
  picked: string;
  setPicked: (id: string) => void;
}

type Err = { title: string; msg: string; browse: boolean };

const BADGE: Record<string, [string, string]> = {
  chrome: ['G', '#1A73E8'],
  edge: ['E', '#0C7C59'],
  brave: ['B', '#D4471F'],
  chromium: ['C', '#5F6368'],
  vivaldi: ['V', '#C8332E']
};

export function BrowserBadge({ b }: { b?: Pick<Browser, 'id' | 'name' | 'icon'> }) {
  if (b?.icon) return <img src={b.icon} alt="" aria-hidden width={22} height={22} style={{ flex: 'none', width: 22, height: 22, objectFit: 'contain' }} />;
  const [initial, color] = (b && BADGE[b.id]) ?? [b?.name.charAt(0).toUpperCase() || '?', b ? '#5F6368' : '#9E9E9E'];
  return (
    <span
      aria-hidden
      style={{
        flex: 'none',
        width: 22,
        height: 22,
        borderRadius: 6,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        color: '#FFFFFF',
        background: color
      }}
    >
      {initial}
    </span>
  );
}

const NO_BROWSER: Err = {
  title: 'No compatible browser found',
  msg: 'No compatible browser found in the usual places. Install Chrome, Edge or Brave, or point to the browser’s executable.',
  browse: true
};
const NOT_CHROMIUM: Err = { title: 'That file can’t be used', msg: 'This doesn’t look like a Chromium-based browser.', browse: true };

/** Last browser list, so the picker doesn't flash "Looking for browsers…" after a tab switch. */
let lastBrowsers: Browser[] | null = null;

const groupHead: CSSProperties = {
  padding: '6px 10px 4px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--muted)'
};

/** Videos tab, right panel: Fetch videos from a page (idle) or the running capture session. */
export function VideosPanel({ settings, capture, link, setLink, picked, setPicked }: Props) {
  const [browsers, setBrowsers] = useState<Browser[] | null>(lastBrowsers);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<Err | null>(null);
  const [linkErr, setLinkErr] = useState('');
  const [starting, setStarting] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const menuRef = useDismiss<HTMLDivElement>(menu, closeMenu);

  const load = useCallback(async () => {
    const list = await window.dl.browsers();
    lastBrowsers = list;
    setBrowsers(list);
    if (!list.length) setErr((e) => e ?? NO_BROWSER);
    else setErr((e) => (e === NO_BROWSER ? null : e));
    return list;
  }, []);

  useEffect(() => {
    void load();
  }, [load, settings.customBrowsers.length]);

  const list = browsers ?? [];
  const defId = list.some((b) => b.id === settings.captureBrowser) ? settings.captureBrowser : list[0]?.id;
  const cur = list.find((b) => b.id === picked) ?? list.find((b) => b.id === defId);
  const detected = list.filter((b) => !b.custom);
  const custom = list.filter((b) => b.custom);

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) {
        setLink(t);
        setLinkErr('');
      }
    } catch {
      setLinkErr('Clipboard is blocked here. Press Ctrl+V in the box instead.');
    }
  };

  const browse = async () => {
    setMenu(false);
    const r = await window.dl.addBrowser();
    if (!r) return;
    if ('error' in r) {
      setErr(NOT_CHROMIUM);
      return;
    }
    setErr(null);
    await load();
    setPicked(r.id);
  };

  const session = capture && (capture.phase === 'starting' || capture.phase === 'browsing') ? capture : null;
  const browsing = session?.phase === 'browsing';
  const valid = /^https?:\/\/\S+$/i.test(link.trim());
  const canStart = !!cur && valid && !starting && !session;

  const start = async () => {
    if (!cur) return setErr(NO_BROWSER);
    if (!valid) return setLinkErr('Paste a page link that starts with http:// or https://');
    setStarting(true);
    setErr(null);
    try {
      const r = await window.dl.startCapture(link.trim(), cur.id);
      if ('error' in r) {
        if (r.error === 'NO_BROWSER') setErr(NO_BROWSER);
        else if (r.error === 'NO_START') setErr({ title: `Couldn’t start ${cur.name}`, msg: r.message ?? `Couldn’t start ${cur.name}. Close it if it’s stuck and try again.`, browse: false });
        else if (r.error === 'BAD_URL') setLinkErr('Paste a page link that starts with http:// or https://');
        else if (r.error === 'BUSY') setErr({ title: 'A capture session is already running', msg: 'End it before fetching another page.', browse: false });
      }
    } finally {
      setStarting(false);
    }
  };

  const option = (b: Browser) => (
    <button
      key={b.id}
      role="option"
      aria-selected={b.id === cur?.id}
      className="dd-option"
      onClick={() => {
        setPicked(b.id);
        setMenu(false);
        setErr(null);
      }}
      style={{ gap: 10, fontWeight: b.id === cur?.id ? 600 : 500, background: b.id === cur?.id ? 'var(--panel2)' : undefined }}
    >
      <BrowserBadge b={b} />
      {b.custom ? (
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', flexDirection: 'column' }}>
          <span>{b.name}</span>
          <span className="mono muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.path}>
            {b.path}
          </span>
        </span>
      ) : (
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>{b.name}</span>
      )}
      <span className="muted" style={{ fontSize: 11 }}>
        {b.id === defId ? 'Default' : ''}
      </span>
    </button>
  );

  return (
    <div
      style={{
        flex: '1 1 300px',
        maxWidth: 380,
        minWidth: 280,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Fetch videos from a page</h2>
        <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
          Opens the page in a browser the app watches. Play the videos you want, then close the browser to see what can be downloaded.
        </div>
      </div>

      {!browsing && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="cap-link" className="label">
              Page link
            </label>
            <textarea
              id="cap-link"
              className="input mono"
              rows={2}
              placeholder="https://example.com/page-with-videos"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setLinkErr('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void start();
                }
              }}
              style={{ resize: 'none', fontSize: 12, lineHeight: 1.5 }}
            />
            {linkErr && <div style={{ fontSize: 12, color: 'var(--err)' }}>{linkErr}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => void paste()} style={{ flex: 1, height: 34, fontSize: 13 }}>
                <Clipboard />
                Paste link
              </button>
              <button
                className="btn"
                aria-label="Clear link"
                title="Clear link"
                disabled={!link}
                onClick={() => {
                  setLink('');
                  setLinkErr('');
                }}
                style={{ width: 34, height: 34, padding: 0, flex: 'none', opacity: link ? 1 : 0.45, cursor: link ? 'pointer' : 'default' }}
              >
                <WinClose w={1.4} />
              </button>
            </div>
          </div>

          <div ref={menuRef} style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
            <span id="cap-browser-lbl" className="label">
              Browser
            </span>
            <button
              aria-haspopup="listbox"
              aria-expanded={menu}
              aria-labelledby="cap-browser-lbl"
              onClick={() => {
                if (!menu) void load();
                setMenu((m) => !m);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                height: 40,
                padding: '0 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                color: 'var(--text)',
                background: 'var(--panel2)',
                border: `1px solid ${menu ? 'var(--accent)' : 'var(--line)'}`
              }}
            >
              <BrowserBadge b={cur} />
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cur?.name ?? (browsers ? 'No browser found' : 'Looking for browsers…')}
              </span>
              {cur && cur.id === defId && (
                <span className="muted" style={{ fontSize: 11 }}>
                  Default
                </span>
              )}
              <Chevron open={menu} />
            </button>
            {menu && (
              <div
                role="listbox"
                aria-labelledby="cap-browser-lbl"
                className="dd-list"
                style={{ left: 0, right: 0, top: 64, zIndex: 25, minWidth: 0 }}
              >
                {detected.length > 0 && <div style={groupHead}>Found on this computer</div>}
                {detected.map(option)}
                {custom.length > 0 && <div style={{ ...groupHead, paddingTop: 8 }}>Added by you</div>}
                {custom.map(option)}
                {list.length > 0 && <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />}
                <button role="option" aria-selected={false} className="dd-option" onClick={() => void browse()} style={{ gap: 10, fontWeight: 600, color: 'var(--accent)' }}>
                  <Folder />
                  Browse…
                </button>
              </div>
            )}
          </div>

          {err && (
            <div role="alert" style={{ border: '1px solid var(--err)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--err)' }}>{err.title}</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {err.msg}
              </div>
              {err.browse && (
                <button className="btn" onClick={() => void browse()} style={{ alignSelf: 'flex-start', height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600 }}>
                  Browse…
                </button>
              )}
            </div>
          )}

          <button className="btn-primary" onClick={() => void start()} disabled={!canStart} style={{ height: 44, fontSize: 14, ...(canStart ? {} : disabledBtn) }}>
            <VideoIcon />
            {starting || session ? `Opening ${cur?.name ?? 'the browser'}…` : 'Fetch videos'}
          </button>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: -6 }}>
            The browser opens with the app's own profile, so your everyday browser isn't touched. Logins you make there are kept for next time.
          </div>
        </>
      )}

      {browsing && session && (
        <>
          <div style={{ border: '1px solid var(--run)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--run)', boxShadow: '0 0 0 4px var(--panel2)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Capture session running</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {session.browserName} · app profile
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <Stat n={session.pages.length} label="pages visited" />
              <Stat n={session.mediaSeen} label="media requests seen" />
            </div>
            {session.pages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={groupHead as CSSProperties}>Pages visited</div>
                {session.pages.map((v, i) => (
                  <div key={`${v.url}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 }}>
                    <span className="mono" title={v.url} style={{ fontSize: 11.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.url}
                    </span>
                    <span style={{ flex: 'none', fontSize: 11, color: v.ok ? 'var(--ok)' : 'var(--muted)' }}>{v.tag}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn" onClick={() => void window.dl.endCapture(session.sessionId)} style={{ height: 40, borderRadius: 10, fontWeight: 600 }}>
              End session
            </button>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: -4 }}>
              Closing the browser's last window also ends the session. The list of videos opens straight away and fills in as scans finish.
            </div>
          </div>
          <button disabled style={{ height: 44, border: 0, borderRadius: 10, fontWeight: 600, fontSize: 14, ...disabledBtn }}>
            Fetch videos · one session at a time
          </button>
        </>
      )}
    </div>
  );
}

const disabledBtn: CSSProperties = { background: 'var(--line)', color: 'var(--muted)', cursor: 'not-allowed' };

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{n}</div>
      <div className="muted" style={{ fontSize: 11 }}>
        {label}
      </div>
    </div>
  );
}
