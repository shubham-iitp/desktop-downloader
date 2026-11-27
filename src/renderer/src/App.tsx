import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AppInfo, CaptureUpdate, EngineStatus, Job, JobUpdate, Settings, Tab } from '@shared/types';
import { tabOf } from '@shared/types';
import { useResolvedTheme } from './hooks';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { Queue } from './components/Queue';
import { AddPanel } from './components/AddPanel';
import { CloseDialog } from './components/CloseDialog';
import { SettingsView, type SettingsSection } from './components/SettingsView';
import { RepairView } from './components/RepairView';
import { LegalNotice } from './components/LegalNotice';
import { RemoveDialog } from './components/RemoveDialog';
import { VideosPanel } from './components/VideosPanel';
import { VideosPopup } from './components/VideosPopup';

type View = 'main' | 'settings';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [view, setView] = useState<View>('main');
  const [section, setSection] = useState<SettingsSection>('general');
  const [tab, setTab] = useState<Tab>('torrent');
  const [closeOpen, setCloseOpen] = useState(false);
  const [openTorrentTick, setOpenTorrentTick] = useState(0);
  const [repair, setRepair] = useState<'none' | 'broken' | 'fixed'>('none');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const closeRemove = useCallback(() => setRemoveId(null), []);
  // A magnet link opened from outside the app (browser click), waiting for the add panel.
  const [incoming, setIncoming] = useState<{ url: string; id: number } | null>(null);
  const takeIncoming = useCallback(() => setIncoming(null), []);
  // V2: the capture session (browsing, then the "Videos found" popup), and a page to fetch again.
  const [capture, setCapture] = useState<CaptureUpdate | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [videoBrowser, setVideoBrowser] = useState('');
  const fetchAgain = useCallback((url: string) => {
    setView('main');
    setTab('videos');
    setVideoLink(url);
  }, []);
  const receiveLink = useCallback((url: string) => {
    setView('main');
    setTab('torrent');
    setIncoming({ url, id: Date.now() });
  }, []);

  useEffect(() => {
    void window.dl.getSettings().then(setSettings);
    void window.dl.list().then((list) => setJobs(new Map(list.map((j) => [j.id, j]))));
    void window.dl.engineStatus().then(setEngine);
    void window.dl.appInfo().then(setInfo);
    const offUpdate = window.dl.onUpdate((updates: JobUpdate[]) =>
      setJobs((prev) => {
        const next = new Map(prev);
        for (const u of updates) {
          if (u.removed) next.delete(u.id);
          else if (u.job) next.set(u.id, u.job);
        }
        return next;
      })
    );
    const offEngine = window.dl.onEngineStatus(setEngine);
    void window.dl.currentCapture().then(setCapture);
    const offCapture = window.dl.onCapture(setCapture);
    void window.dl.takePendingLink().then((link) => link && receiveLink(link));
    const offLink = window.dl.onOpenLink(receiveLink);
    const offCmd = window.dl.onCommand((c) => {
      if (c === 'ask-close') setCloseOpen(true);
      if (c === 'settings') setView('settings');
      if (c === 'open-torrent') {
        setView('main');
        setTab('torrent');
        setOpenTorrentTick((n) => n + 1);
      }
    });
    return () => {
      offUpdate();
      offEngine();
      offCapture();
      offCmd();
      offLink();
    };
  }, [receiveLink]);

  // Repair screen: shown while the engine is missing or crashed, then a "running again" state.
  useEffect(() => {
    if (!engine) return;
    if (engine.state === 'missing' || engine.state === 'crashed') setRepair('broken');
    else if (engine.state === 'running') setRepair((r) => (r === 'broken' ? 'fixed' : r));
  }, [engine]);

  // Keyboard shortcuts (macOS gets these from the native menu).
  useEffect(() => {
    if (!info || info.isMac) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'q') {
        e.preventDefault();
        void window.dl.quit();
      } else if (k === 'o') {
        e.preventDefault();
        setView('main');
        setTab('torrent');
        setOpenTorrentTick((n) => n + 1);
      } else if (k === ',') {
        e.preventDefault();
        setView('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [info]);

  const theme = useResolvedTheme(settings?.theme ?? 'system');

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    try {
      setSettings(await window.dl.setSettings(patch));
    } catch {
      setSettings(await window.dl.getSettings());
    }
  }, []);

  const list = useMemo(() => [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt), [jobs]);
  const counts = useMemo(() => {
    let active = 0;
    let queued = 0;
    let torrent = 0;
    let normal = 0;
    let videos = 0;
    let videoActive = 0;
    let videoQueued = 0;
    for (const j of list) {
      const t = tabOf(j.kind);
      if (t === 'torrent') torrent++;
      else if (t === 'videos') videos++;
      else normal++;
      // yt-dlp has its own 3 slots; everything else shares aria2's.
      const busy = j.status === 'active' || j.status === 'postprocessing';
      if (j.engine === 'ytdlp') {
        if (busy) videoActive++;
        if (j.status === 'queued') videoQueued++;
      } else {
        if (busy) active++;
        if (j.status === 'queued') queued++;
      }
    }
    return { active, queued, torrent, normal, videos, videoActive, videoQueued };
  }, [list]);

  if (!settings || !info) return <div className={`app theme-${theme}`} />;

  const style = { '--font': `'${settings.font}'` } as CSSProperties;
  const isMac = info.isMac;
  const showRepair = repair !== 'none' && view === 'main';

  return (
    <div className={`app theme-${theme}`} style={style}>
      {view === 'settings' ? (
        <SettingsView
          settings={settings}
          update={updateSettings}
          section={section}
          setSection={setSection}
          engine={engine}
          isMac={isMac}
          theme={theme}
          onBack={() => setView('main')}
          version={info.version}
        />
      ) : showRepair ? (
        <RepairView
          engine={engine}
          state={repair}
          isMac={isMac}
          platform={info.platform}
          onBack={() => setRepair('none')}
        />
      ) : (
        <>
          <TitleBar
            isMac={isMac}
            title="Downloader"
            onSettings={() => setView('settings')}
            onOpenTorrent={() => {
              setTab('torrent');
              setOpenTorrentTick((n) => n + 1);
            }}
            withFileMenu
          />
          <Toolbar
            tab={tab}
            setTab={setTab}
            counts={counts}
            parallel={settings.maxConcurrent}
          />
          <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', padding: '20px 24px 24px' }}>
              <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <LegalNotice />
                <Queue tab={tab} jobs={list} density={settings.density} onRemove={(j) => setRemoveId(j.id)} onFetchAgain={fetchAgain} />
              </div>
              {tab === 'videos' ? (
                <VideosPanel
                  settings={settings}
                  capture={capture}
                  link={videoLink}
                  setLink={setVideoLink}
                  picked={videoBrowser}
                  setPicked={setVideoBrowser}
                />
              ) : (
                <AddPanel
                  key={tab}
                  tab={tab}
                  settings={settings}
                  openTorrentTick={openTorrentTick}
                  incoming={tab === 'torrent' ? incoming : null}
                  onIncomingTaken={takeIncoming}
                />
              )}
            </div>
          </div>
        </>
      )}
      {capture && (capture.phase === 'scanning' || capture.phase === 'done') && view === 'main' && (
        <VideosPopup
          key={capture.sessionId}
          capture={capture}
          settings={settings}
          onClose={() => void window.dl.discardCapture(capture.sessionId)}
          onFetchAgain={(url) => {
            void window.dl.discardCapture(capture.sessionId);
            fetchAgain(url);
          }}
          onAdded={() => setTab('videos')}
        />
      )}
      {removeId && jobs.get(removeId) && <RemoveDialog job={jobs.get(removeId)!} onClose={closeRemove} />}
      {closeOpen && (
        <CloseDialog
          active={counts.active + counts.videoActive}
          queued={counts.queued + counts.videoQueued}
          onChoice={(c) => {
            setCloseOpen(false);
            void window.dl.closeChoice(c);
          }}
        />
      )}
    </div>
  );
}
