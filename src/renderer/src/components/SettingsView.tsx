import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FONTS, type Browser, type EngineInfo, type EngineStatus, type EnginesStatus, type FontName, type Settings } from '@shared/types';
import { ChevronLeft } from '../icons';
import { useTick } from '../hooks';
import { TitleBar } from './TitleBar';
import { Dropdown, SpeedSlider, Stepper, Switch } from './controls';

export type SettingsSection = 'general' | 'downloads' | 'engine' | 'capture' | 'appearance';

const LABELS: Record<SettingsSection, string> = {
  general: 'General',
  downloads: 'Downloads & folders',
  engine: 'Engines',
  capture: 'Video capture',
  appearance: 'Appearance'
};
const INTROS: Record<SettingsSection, string> = {
  general: 'How Downloader starts and tells you what happened. Closing the window always asks whether to hide to the tray or quit.',
  downloads: 'Where files go and the defaults new downloads start with. You can still change them per download.',
  engine: 'aria2c handles file links and torrents. yt-dlp, with ffmpeg and Deno, handles videos. All of them ship with the app.',
  capture: 'Fetch videos opens pages in a browser the app watches. Choose which browser, and manage what it remembers.',
  appearance: 'How Downloader looks.'
};

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  section: SettingsSection;
  setSection: (s: SettingsSection) => void;
  engine: EngineStatus | null;
  isMac: boolean;
  theme: 'light' | 'dark';
  onBack: () => void;
  version: string;
}

export function SettingsView({ settings: s, update, section, setSection, engine, isMac, onBack, version }: Props) {
  return (
    <>
      <TitleBar isMac={isMac} title="Downloader · Settings" />
      <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, padding: 24 }}>
          <nav aria-label="Settings sections" style={{ flex: '1 1 200px', maxWidth: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button className="btn st-btn" onClick={onBack} style={{ width: 'fit-content', marginBottom: 12 }}>
              <ChevronLeft />
              Downloads
            </button>
            {(Object.keys(LABELS) as SettingsSection[]).map((k) => (
              <button
                key={k}
                aria-current={k === section ? 'page' : undefined}
                onClick={() => setSection(k)}
                style={{
                  textAlign: 'left',
                  padding: '9px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: k === section ? 'var(--panel)' : 'transparent',
                  border: `1px solid ${k === section ? 'var(--line)' : 'transparent'}`,
                  color: k === section ? 'var(--text)' : 'var(--muted)',
                  fontWeight: k === section ? 600 : 500
                }}
              >
                {LABELS[k]}
              </button>
            ))}
          </nav>

          <main style={{ flex: '999 1 560px', minWidth: 0, maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{LABELS[section]}</h1>
              <p className="muted" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
                {INTROS[section]}
              </p>
            </div>
            {section === 'general' && <General s={s} update={update} version={version} />}
            {section === 'downloads' && <Downloads s={s} update={update} />}
            {section === 'engine' && <Engine s={s} update={update} engine={engine} />}
            {section === 'capture' && <Capture s={s} update={update} />}
            {section === 'appearance' && <Appearance s={s} update={update} />}
          </main>
        </div>
      </div>
    </>
  );
}

type SectionProps = { s: Settings; update: (p: Partial<Settings>) => void };

function Row({ title, hint, children, labelFor, id }: { title: string; hint: string; children: ReactNode; labelFor?: string; id?: string }) {
  return (
    <div className="st-row">
      <div>
        {labelFor ? (
          <label htmlFor={labelFor} className="st-t">
            {title}
          </label>
        ) : (
          <div id={id} className="st-t">
            {title}
          </div>
        )}
        <div className="st-h">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function General({ s, update, version }: SectionProps & { version: string }) {
  return (
    <>
      <div className="st-card">
        <Row title="Start Downloader when I sign in" hint="Opens minimised in the tray so queued downloads continue.">
          <Switch on={s.startOnLogin} label="Start when I sign in" onChange={(v) => update({ startOnLogin: v })} />
        </Row>
        <Row title="Notify when a download finishes" hint="A system notification; click it to open the folder.">
          <Switch on={s.notifyDone} label="Notify when a download finishes" onChange={(v) => update({ notifyDone: v })} />
        </Row>
        <Row title="Notify when a download fails" hint="Network errors are retried 3 times before you're told.">
          <Switch on={s.notifyFail} label="Notify when a download fails" onChange={(v) => update({ notifyFail: v })} />
        </Row>
        <Row title="Resume unfinished downloads on launch" hint="Picks up from the saved session instead of starting paused.">
          <Switch on={s.resumeOnLaunch} label="Resume unfinished downloads on launch" onChange={(v) => update({ resumeOnLaunch: v })} />
        </Row>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        Desktop Downloader {version}. Downloads run through aria2c (GPL-2.0-or-later), and videos through yt-dlp (Unlicense) with ffmpeg
        (GPL-3.0) and Deno (MIT), each shipped as a separate program with its license text. You're responsible for following copyright law and each site's terms for what you download.
      </p>
    </>
  );
}

function Downloads({ s, update }: SectionProps) {
  const [dirN, setDirN] = useState(s.dirNormal);
  const [dirT, setDirT] = useState(s.dirTorrent);
  const [dirV, setDirV] = useState(s.dirVideos);
  const browse = async (key: 'dirNormal' | 'dirTorrent' | 'dirVideos', cur: string, set: (v: string) => void) => {
    const dir = await window.dl.pickFolder(cur);
    if (dir) {
      set(dir);
      update({ [key]: dir });
    }
  };
  return (
    <div className="st-card">
      <Row title="Folder for file links" hint="Used by the Normal tab unless you pick another." labelFor="st-dir-n">
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="st-dir-n" className="st-path" value={dirN} onChange={(e) => setDirN(e.target.value)} onBlur={() => dirN && update({ dirNormal: dirN })} />
          <button className="btn st-btn" onClick={() => void browse('dirNormal', dirN, setDirN)}>
            Browse…
          </button>
        </div>
      </Row>
      <Row title="Folder for torrents" hint="Used by the Torrent tab." labelFor="st-dir-t">
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="st-dir-t" className="st-path" value={dirT} onChange={(e) => setDirT(e.target.value)} onBlur={() => dirT && update({ dirTorrent: dirT })} />
          <button className="btn st-btn" onClick={() => void browse('dirTorrent', dirT, setDirT)}>
            Browse…
          </button>
        </div>
      </Row>
      <Row title="Folder for videos" hint="Where Fetch videos saves to. You can pick another in the list of videos found." labelFor="st-dir-v">
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="st-dir-v" className="st-path" value={dirV} onChange={(e) => setDirV(e.target.value)} onBlur={() => dirV && update({ dirVideos: dirV })} />
          <button className="btn st-btn" onClick={() => void browse('dirVideos', dirV, setDirV)}>
            Browse…
          </button>
        </div>
      </Row>
      <Row title="Parallel downloads" hint="How many downloads run at once, across both tabs. The rest wait in the queue.">
        <Stepper value={s.maxConcurrent} min={1} max={10} onChange={(n) => update({ maxConcurrent: n })} decLabel="Fewer parallel downloads" incLabel="More parallel downloads" />
      </Row>
      <Row title="Connections per file" hint="How many parts a file link is split into. aria2c allows up to 16.">
        <Stepper value={s.connectionsPerFile} min={1} max={16} onChange={(n) => update({ connectionsPerFile: n })} decLabel="Fewer connections" incLabel="More connections" />
      </Row>
      <Row title="Peers per torrent" hint="The most peers one torrent connects to at once.">
        <Stepper value={s.peersPerTorrent} min={5} max={200} step={5} onChange={(n) => update({ peersPerTorrent: n })} decLabel="Fewer peers" incLabel="More peers" />
      </Row>
      <Row title="If the file already exists" hint="Unfinished files with the same name are always resumed instead." id="lbl-exists">
        <Dropdown
          labelId="lbl-exists"
          value={s.ifExists}
          onChange={(v) => update({ ifExists: v })}
          options={[
            ['rename', 'Keep both (add a number)'],
            ['overwrite', 'Replace the old file'],
            ['skip', 'Skip the download'],
            ['ask', 'Ask every time']
          ]}
        />
      </Row>
      <Row title="Reserve disk space before downloading" hint="Fails early if the drive is too small. Not used on macOS, where it would write zeros.">
        <Switch on={s.prealloc} label="Reserve disk space" onChange={(v) => update({ prealloc: v })} />
      </Row>
    </div>
  );
}

function uptime(since?: number): string {
  if (!since) return '';
  const sec = Math.floor((Date.now() - since) / 1000);
  if (sec < 60) return 'running for a few seconds';
  const m = Math.floor(sec / 60);
  if (m < 60) return `running for ${m} min`;
  return `running for ${Math.floor(m / 60)} h ${m % 60} min`;
}

function Engine({ s, update, engine }: SectionProps & { engine: EngineStatus | null }) {
  useTick(30_000);
  const [restarting, setRestarting] = useState(false);
  const state = restarting ? 'restarting' : (engine?.state ?? 'starting');
  const label = { running: 'Running', restarting: 'Restarting…', starting: 'Starting…', missing: 'Missing', crashed: 'Stopped' }[state];
  const col = state === 'running' ? 'var(--ok)' : state === 'missing' || state === 'crashed' ? 'var(--err)' : 'var(--accent)';
  const restart = async () => {
    setRestarting(true);
    try {
      await window.dl.restartEngine();
    } finally {
      setRestarting(false);
    }
  };
  return (
    <>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>aria2c</span>
              <span className="mono" style={{ fontSize: 13 }}>
                {engine?.version ?? '1.37.0'}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                Bundled
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              HTTP, HTTPS, FTP, SFTP, BitTorrent, magnet links and Metalink
            </div>
          </div>
          <span className="badge" style={{ color: col }}>
            {label}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {['Local only (127.0.0.1)', state === 'running' ? uptime(engine?.startedAt) : engine?.error, 'queue saved to the session file on quit']
            .filter(Boolean)
            .join(' · ')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <code className="mono muted" style={{ fontSize: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
            {engine?.binPath}
          </code>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn st-btn" onClick={() => void restart()} disabled={restarting}>
              {restarting ? 'Restarting…' : 'Restart engine'}
            </button>
            <button className="btn st-btn" onClick={() => void window.dl.openLog()}>
              Open log
            </button>
          </div>
        </div>
      </div>
      <VideoEngines />
      <div className="st-card">
        <SpeedSlider
          id="st-speed"
          title="Download speed limit"
          hint="Caps all downloads together."
          value={s.downloadLimit}
          onChange={(v) => update({ downloadLimit: v })}
        />
        <SpeedSlider
          id="st-upspeed"
          title="Upload speed limit"
          hint="Caps what torrents send to other peers while downloading and seeding. HTTP and FTP downloads don’t upload. Lower limits can make torrents download more slowly."
          value={s.uploadLimit}
          onChange={(v) => update({ uploadLimit: v })}
        />
        <Row title="After a torrent finishes" hint="Seeding shares the file back with other peers." id="st-seed">
          <Dropdown
            labelId="st-seed"
            value={s.seedMode}
            onChange={(v) => update({ seedMode: v })}
            options={[
              ['0', 'Stop seeding'],
              ['30', 'Seed for 30 minutes'],
              ['120', 'Seed for 2 hours'],
              ['ratio', 'Seed until ratio 1.0']
            ]}
          />
        </Row>
        <Row title="Keep finished downloads in history" hint="Only the list entry; files on disk are never touched." id="st-hist">
          <Dropdown
            labelId="st-hist"
            value={s.historyKeep}
            onChange={(v) => update({ historyKeep: v })}
            options={[
              ['7', '7 days'],
              ['30', '30 days'],
              ['90', '90 days'],
              ['forever', 'Forever']
            ]}
          />
        </Row>
      </div>
    </>
  );
}

const ROLES: Record<string, string> = {
  'yt-dlp': 'Videos from pages and captured streams. Up to 3 video downloads run at a time.',
  ffmpeg: 'Merges video and audio, and extracts audio for the M4A and MP3 options.',
  Deno: 'Runs the site player code yt-dlp needs for YouTube.'
};

/** yt-dlp, ffmpeg and Deno cards under aria2c (V2 Engines design). */
function VideoEngines() {
  const [st, setSt] = useState<EnginesStatus | null>(null);
  useEffect(() => {
    void window.dl.enginesStatus().then(setSt);
    return window.dl.onEngines(setSt);
  }, []);
  if (!st) return null;
  const card = (e: EngineInfo, extra?: ReactNode, status?: [string, string]) => {
    const [label, col] = status ?? (e.ready ? ['Ready', 'var(--ok)'] : ['Missing', 'var(--err)']);
    return (
      <div key={e.name} className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{e.name}</span>
              <span className="mono" style={{ fontSize: 13 }}>
                {e.version}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {e.source}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              {ROLES[e.name]}
            </div>
          </div>
          <span className="badge" style={{ color: col }}>
            {label}
          </span>
        </div>
        {extra}
      </div>
    );
  };
  const y = st.ytdlp;
  return (
    <>
      {card(
        y,
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {y.note}
          </span>
          <button className="btn st-btn" disabled={y.checking} onClick={() => void window.dl.checkYtdlp().then(setSt)}>
            {y.checking ? 'Checking…' : 'Check now'}
          </button>
        </div>,
        y.checking ? ['Checking…', 'var(--accent)'] : y.ready ? ['Up to date', 'var(--ok)'] : ['Missing', 'var(--err)']
      )}
      {card(st.ffmpeg)}
      {card(st.deno)}
    </>
  );
}

function Capture({ s, update }: SectionProps) {
  const [browsers, setBrowsers] = useState<Browser[] | null>(null);
  const [cleared, setCleared] = useState<'' | 'done' | 'busy'>('');
  const [addErr, setAddErr] = useState('');
  useEffect(() => {
    void window.dl.browsers().then(setBrowsers);
  }, [s.customBrowsers.length]);
  const list = browsers ?? [];
  const value = list.some((b) => b.id === s.captureBrowser) ? s.captureBrowser : (list[0]?.id ?? '');
  const custom = s.customBrowsers;
  const add = async () => {
    setAddErr('');
    const r = await window.dl.addBrowser();
    if (r && 'error' in r) setAddErr('This doesn’t look like a Chromium-based browser.');
    else if (r) update({}); // refresh settings (customBrowsers changed in the main process)
  };
  return (
    <>
      <div className="st-card">
        <Row
          title="Default browser for Fetch videos"
          hint="You can still pick another one each time you fetch. Only Chromium-based browsers work: Chrome, Edge, Brave, Chromium, Vivaldi."
          id="lbl-browser"
        >
          {list.length ? (
            <Dropdown labelId="lbl-browser" value={value} onChange={(v) => update({ captureBrowser: v })} options={list.map((b) => [b.id, b.name] as [string, string])} />
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>
              {browsers ? 'No browser found' : 'Looking…'}
            </span>
          )}
        </Row>
      </div>
      <div className="st-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div className="st-t">Browsers you added</div>
          <div className="st-h">Added with Browse…. Each one is checked to be Chromium-based before it's saved.</div>
        </div>
        {custom.map((b) => (
          <div
            key={b.id}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)', flexWrap: 'wrap' }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600 }}>{b.name}</div>
              <code className="mono muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
                {b.path}
              </code>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--ok)', color: 'var(--ok)' }}>Verified</span>
            <button className="btn st-btn" onClick={() => void window.dl.removeBrowser(b.id).then(() => update({}))}>
              Remove
            </button>
          </div>
        ))}
        {!custom.length && (
          <div className="muted" style={{ fontSize: 13 }}>
            None yet.
          </div>
        )}
        {addErr && <div style={{ fontSize: 12, color: 'var(--err)' }}>{addErr}</div>}
        <button className="btn st-btn" style={{ alignSelf: 'flex-start' }} onClick={() => void add()}>
          Browse for a browser…
        </button>
      </div>
      <div className="st-card" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="st-t">Capture browser data</div>
          <div className="st-h">
            Logins and cookies from capture sessions live in the app's own browser profile, separate from your everyday browser. Clearing signs you out of those sites.
          </div>
          {cleared && (
            <div style={{ fontSize: 12, color: cleared === 'done' ? 'var(--ok)' : 'var(--err)', marginTop: 6, fontWeight: 600 }}>
              {cleared === 'done' ? 'Capture browser data cleared.' : 'End the capture session first.'}
            </div>
          )}
        </div>
        <button
          onClick={() => void window.dl.clearCaptureData().then((ok) => setCleared(ok ? 'done' : 'busy'))}
          style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--err)', background: 'transparent', color: 'var(--err)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Clear capture browser data
        </button>
      </div>
    </>
  );
}

const PREVIEW = { dark: ['#121212', '#1E1E1E', '#333333', '#FF7676'], light: ['#F5F5F5', '#FFFFFF', '#E0E0E0', '#C53030'] };

function Appearance({ s, update }: SectionProps) {
  const half = (p: string[]): CSSProperties => ({ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: 10, background: p[0] });
  return (
    <>
      <div className="st-card" style={{ padding: 16 }}>
        <div className="st-t">Theme</div>
        <div className="st-h" style={{ marginBottom: 14 }}>
          System follows your computer's light or dark setting and switches with it.
        </div>
        <div role="radiogroup" aria-label="Theme" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {(
            [
              ['dark', 'Dark'],
              ['light', 'Light'],
              ['system', 'System']
            ] as const
          ).map(([k, label]) => {
            const on = s.theme === k;
            const L = k === 'light' ? PREVIEW.light : PREVIEW.dark;
            const R = k === 'dark' ? PREVIEW.dark : PREVIEW.light;
            const bars = (p: string[]) => (
              <>
                <div style={{ height: 8, width: '60%', borderRadius: 4, background: p[3] }} />
                <div style={{ height: 8, borderRadius: 4, background: p[2] }} />
                <div style={{ height: 8, borderRadius: 4, background: p[2] }} />
              </>
            );
            return (
              <button
                key={k}
                role="radio"
                aria-checked={on}
                onClick={() => update({ theme: k })}
                style={{
                  textAlign: 'left',
                  padding: 10,
                  borderRadius: 12,
                  cursor: 'pointer',
                  color: 'var(--text)',
                  background: 'var(--panel2)',
                  border: `2px solid ${on ? 'var(--accent)' : 'var(--line)'}`
                }}
              >
                <div style={{ height: 84, borderRadius: 8, overflow: 'hidden', display: 'flex', border: '1px solid var(--line)' }}>
                  <div style={half(L)}>{bars(L)}</div>
                  <div style={half(R)}>{bars(R)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 600 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      boxSizing: 'border-box',
                      border: on ? '4px solid var(--accent)' : '2px solid var(--muted)'
                    }}
                  />
                  {label}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="st-card">
        <Row title="Font" hint="Used across the whole app. Each option is shown in its own typeface." id="lbl-font">
          <Dropdown<FontName> labelId="lbl-font" value={s.font} onChange={(v) => update({ font: v })} options={FONTS.map((f) => [f, f])} fontPreview />
        </Row>
        <Row title="Queue density" hint="Compact fits about twice as many downloads on screen." id="lbl-density">
          <Dropdown
            labelId="lbl-density"
            value={s.density}
            onChange={(v) => update({ density: v })}
            options={[
              ['comfortable', 'Comfortable'],
              ['compact', 'Compact']
            ]}
          />
        </Row>
      </div>
    </>
  );
}
