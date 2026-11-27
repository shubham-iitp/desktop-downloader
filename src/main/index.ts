import path from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme, Notification, session, shell } from 'electron';
import type { AppCommand, CloseChoice, Job, Settings } from '@shared/types';
import { aria2cPath } from './bin';
import { Db } from './db';
import { SettingsStore } from './settings';
import { Aria2Daemon } from './aria2/daemon';
import { JobManager } from './jobs/JobManager';
import { registerIpc } from './ipc';
import { AppTray, appIcon } from './tray';
import { log } from './log';
import { fetchTorrentFile } from './probe';
import { CaptureManager } from './capture/session';
import { Engines, scanPage } from './ytdlp/ytdlp';

// Development only: a separate profile (queue, settings, session) so a dev run never
// touches the installed app's data or collides with its single-instance lock.
if (!app.isPackaged && process.env.DD_USER_DATA) app.setPath('userData', process.env.DD_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const startHidden = process.argv.includes('--hidden');

/** A magnet link passed on the command line (Windows/Linux protocol launch). Only magnet: is accepted. */
function magnetFrom(argv: string[]): string | undefined {
  const link = argv.find((a) => /^magnet:\?/i.test(a));
  return link && link.length <= 65_536 ? link : undefined;
}

// A magnet link that arrived before the window could take it (cold start).
let pendingLink: string | undefined = magnetFrom(process.argv);
let win: BrowserWindow | undefined;
let quitting = false;
let shutdownDone = false;

const db = new Db(app.getPath('userData'));
const settings = new SettingsStore(db);
const daemon = new Aria2Daemon({ bin: aria2cPath(), userData: app.getPath('userData') }, () => settings.get());

const notifier = {
  done(job: Job) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: 'Download finished', body: job.title, icon: appIcon() });
    n.on('click', () => {
      const f = job.files[0];
      if (f) shell.showItemInFolder(f);
      else void shell.openPath(job.dir);
    });
    n.show();
  },
  failed(job: Job) {
    if (!Notification.isSupported()) return;
    new Notification({ title: 'Download failed', body: `${job.title}\n${job.error?.message ?? ''}`, icon: appIcon() }).show();
  }
};

const jobs = new JobManager(db, settings, notifier, () => daemon.readLogTail(200), fetchTorrentFile, (p) => shell.trashItem(p));

// V2: Fetch videos (capture sessions) and the yt-dlp / ffmpeg / Deno engines.
const capture = new CaptureManager(app.getPath('userData'), settings);
const engines = new Engines(
  () => db.getSetting<number>('ytdlpLastCheck') ?? 0,
  (t) => db.setSetting('ytdlpLastCheck', t),
  (s) => send('engines:update', s)
);
let lastExtractorCheck = 0;
jobs.setMediaServices({
  rescan: (pageUrl, cookieFile) => scanPage(pageUrl, cookieFile),
  // A yt-dlp extractor error is often fixed by a newer yt-dlp: check, at most hourly.
  checkYtdlp: () => {
    if (Date.now() - lastExtractorCheck < 3_600_000) return;
    lastExtractorCheck = Date.now();
    void engines.checkNow().catch(() => {});
  },
  cookieInUse: (f) => capture.cookieInUse(f)
});
let lastPhase = '';
capture.on('update', (u: { phase: string } | null) => {
  send('capture:update', u);
  // Session ended (window closed or End session): bring Downloader forward for "Videos found".
  if (u && u.phase === 'scanning' && lastPhase === 'browsing') showWindow();
  lastPhase = u?.phase ?? '';
});

const tray = new AppTray({
  show: () => showWindow(),
  pauseAll: () => void jobs.pauseAll().then(() => tray.refresh()),
  resumeAll: () => void jobs.resumeAll().then(() => tray.refresh()),
  quit: () => app.quit(), // explicit quit: no prompt
  counts: () => {
    const c = jobs.counts();
    return { ...c, anyRunning: c.active + c.queued > 0 };
  }
});

function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function sendCommand(cmd: AppCommand) {
  send('app:command', cmd);
}

/** Brings the window forward and hands it a magnet link to show in the Torrent tab. */
function openLink(link: string) {
  showWindow();
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) send('app:openLink', link);
  else pendingLink = link; // the renderer collects it with app:takePendingLink once loaded
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function backgroundFor(s: Settings): string {
  const dark = s.theme === 'dark' || (s.theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#121212' : '#F5F5F5';
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: isMac, // custom title bar on Windows/Linux, as in the design
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    backgroundColor: backgroundFor(settings.get()),
    icon: appIcon(),
    title: 'Downloader',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Electron has no context menu by default: give text fields the usual Cut / Copy / Paste.
  win.webContents.on('context-menu', (_e, params) => {
    const f = params.editFlags;
    const items: Electron.MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: 'undo', enabled: f.canUndo },
          { role: 'redo', enabled: f.canRedo },
          { type: 'separator' },
          { role: 'cut', enabled: f.canCut },
          { role: 'copy', enabled: f.canCopy },
          { role: 'paste', enabled: f.canPaste },
          { type: 'separator' },
          { role: 'selectAll', enabled: f.canSelectAll }
        ]
      : params.selectionText.trim()
        ? [{ role: 'copy' }]
        : [];
    if (items.length && win) Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.once('ready-to-show', () => {
    if (!startHidden || pendingLink) win?.show();
  });

  // The close button always asks: Hide to tray / Quit / Cancel (rendered by the app's own dialog).
  win.on('close', (e) => {
    if (quitting) return; // explicit quit: no prompt
    e.preventDefault();
    if (!win?.isVisible()) return;
    sendCommand('ask-close');
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function onCloseChoice(choice: CloseChoice) {
  if (choice === 'hide') {
    win?.hide();
    tray.notifyFirstHide(settings.getFlag('hideNotified'), () => settings.setFlag('hideNotified', true));
  } else if (choice === 'quit') {
    app.quit();
  }
}

function onSettingsChanged(prev: Settings, next: Settings) {
  void jobs.applySettings(prev, next);
  if (prev.startOnLogin !== next.startOnLogin) applyLoginItem(next.startOnLogin);
  if (prev.theme !== next.theme) nativeTheme.themeSource = next.theme;
}

function applyLoginItem(on: boolean) {
  if (process.platform === 'linux') return; // no login items API; users add an autostart entry
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null); // the renderer draws its own File menu and handles shortcuts
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: () => (showWindow(), sendCommand('settings')) },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { type: 'separator' },
          { label: 'Quit Downloader', accelerator: 'Cmd+Q', click: () => app.quit() }
        ]
      },
      {
        label: 'File',
        submenu: [
          { label: 'Open .torrent file…', accelerator: 'Cmd+O', click: () => (showWindow(), sendCommand('open-torrent')) },
          { type: 'separator' },
          { role: 'close' }
        ]
      },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ])
  );
}

// ---- engine wiring
daemon.on('status', (s) => send('engine:status', s));
daemon.on('ready', (client) => void jobs.attach(client).then(() => tray.refresh()));
daemon.on('event', (e) => void jobs.onEvent(e).then(() => tray.refresh()));
daemon.on('status', (s) => {
  if (s.state !== 'running') jobs.detach();
});
jobs.on('update', (updates) => {
  send('job:update', updates);
  tray.refresh();
});

registerIpc({
  jobs,
  settings,
  daemon,
  capture,
  engines,
  getWindow: () => win,
  onCloseChoice,
  onSettingsChanged,
  quit: () => app.quit(),
  takePendingLink: () => {
    const link = pendingLink;
    pendingLink = undefined;
    return link ?? null;
  },
  appInfo: () => ({ platform: process.platform, version: app.getVersion(), isMac: process.platform === 'darwin' })
});

// Clicking a magnet link while the app runs starts a second instance; it forwards argv here.
app.on('second-instance', (_e, argv) => {
  const link = magnetFrom(argv);
  if (link) openLink(link);
  else showWindow();
});
// macOS delivers protocol launches as open-url (before or after ready).
app.on('open-url', (e, url) => {
  e.preventDefault();
  if (!/^magnet:\?/i.test(url)) return;
  if (app.isReady()) openLink(url);
  else pendingLink = url;
});
app.on('activate', () => showWindow());
app.on('window-all-closed', () => {
  /* keep running in the tray */
});

app.on('before-quit', (e) => {
  quitting = true;
  if (shutdownDone) return;
  e.preventDefault();
  void (async () => {
    try {
      await capture.shutdown();
      await jobs.shutdown();
      await daemon.stop(); // saveSession + shutdown, 3 s kill fallback
    } catch (err) {
      log.error('shutdown failed', err);
    }
    shutdownDone = true;
    tray.destroy();
    db.close();
    app.quit();
  })();
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.desktopdownloader.app');
  nativeTheme.themeSource = settings.get().theme;
  // The UI needs only clipboard access and notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(['clipboard-read', 'clipboard-sanitized-write', 'notifications'].includes(permission))
  );
  buildMenu();
  // Become the handler for magnet: links once, on first run of the installed app (a dev run
  // would point them at the bare Electron binary). If the user later picks another torrent
  // client, we don't take the links back. The uninstaller removes our registration.
  // The portable exe unpacks to a temp folder on each start, so register the exe the user
  // actually ran (electron-builder sets PORTABLE_EXECUTABLE_FILE), not the temp copy.
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  const handlerArgs: [string, string?, string[]?] = portableExe ? ['magnet', portableExe, []] : ['magnet'];
  if (app.isPackaged && !settings.getFlag(portableExe ? 'magnetRegisteredPortable' : 'magnetRegistered')) {
    if (app.isDefaultProtocolClient(...handlerArgs) || app.setAsDefaultProtocolClient(...handlerArgs)) {
      settings.setFlag(portableExe ? 'magnetRegisteredPortable' : 'magnetRegistered', true);
    }
  }
  jobs.load();
  jobs.startMedia(); // video jobs don't wait for aria2
  tray.create();
  createWindow();
  engines.maybeAutoUpdate();
  await daemon.start();

  // Auto-update works for the installed (NSIS) build only, not the portable exe.
  if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE) {
    try {
      const { autoUpdater } = await import('electron-updater');
      void autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      log.warn('auto-update unavailable', e);
    }
  }
});
