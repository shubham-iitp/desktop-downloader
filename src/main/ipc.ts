import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { Browser, CloseChoice, JobError, ProbeResult, Result, Settings } from '@shared/types';
import { AppError, type JobManager } from './jobs/JobManager';
import type { SettingsStore } from './settings';
import { settingsPatchSchema } from './settings';
import type { Aria2Daemon } from './aria2/daemon';
import { probeFtp, probeHttp } from './probe';
import { routeLink } from './probeParse';
import { log } from './log';
import type { CaptureManager } from './capture/session';
import { verifyBrowser } from './capture/browsers';
import type { Engines } from './ytdlp/ytdlp';

export interface IpcDeps {
  jobs: JobManager;
  settings: SettingsStore;
  daemon: Aria2Daemon;
  capture: CaptureManager;
  engines: Engines;
  getWindow: () => BrowserWindow | undefined;
  onCloseChoice: (choice: CloseChoice) => void;
  onSettingsChanged: (prev: Settings, next: Settings) => void;
  quit: () => void;
  takePendingLink: () => string | null;
  appInfo: () => { platform: string; version: string; isMac: boolean };
}

const id = z.string().uuid();
const headers = z.array(z.string().max(8192).regex(/^[A-Za-z0-9-]+\s*:/)).max(50);
const jobKind = z.enum(['file', 'torrent', 'metalink', 'media']);
const linkUrl = z.string().min(1).max(65_536);

const addSchema = z
  .object({
    url: linkUrl,
    kind: jobKind,
    dir: z.string().max(4096).optional(),
    filename: z.string().max(1024).optional(),
    probeId: z.string().uuid().optional(),
    resumable: z.boolean().optional(),
    size: z.number().nonnegative().nullable().optional(),
    force: z.boolean().optional(),
    media: z.object({ sessionId: z.string().uuid(), itemId: z.string().max(32), quality: z.string().max(32) }).strict().optional(),
    options: z
      .object({
        connections: z.number().int().min(1).max(200).optional(),
        speedLimitKBps: z.number().int().min(1).max(10_000_000).optional(),
        headers: headers.optional(),
        selectFiles: z.array(z.number().int().min(1)).max(100_000).optional(),
        overwrite: z.boolean().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const probeOpts = z.object({ headers: headers.optional(), dir: z.string().max(4096).optional() }).strict().optional();

const ALLOWED_EXTERNAL = /^(https:\/\/|windowsdefender:|x-apple\.systempreferences:)/i;

function toError(e: unknown): JobError {
  if (e instanceof AppError) return e.toJobError();
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (!(e instanceof AppError)) log.warn('ipc handler failed', e);
    return { ok: false, error: toError(e) };
  }
}

export function registerIpc(d: IpcDeps): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;

  /** Only the app's own page may call privileged handlers. */
  const trusted = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? '';
    return devUrl ? url.startsWith(devUrl) : url.startsWith('file://');
  };

  const handle = <S extends z.ZodType<unknown[]>, R>(channel: string, schema: S | null, fn: (...args: z.output<S>) => R | Promise<R>) => {
    ipcMain.handle(channel, async (e, ...raw) => {
      if (!trusted(e)) throw new Error('Untrusted sender');
      const args = (schema ? schema.parse(raw) : []) as z.output<S>;
      return fn(...args);
    });
  };

  // ---- jobs
  handle('job:probe', z.tuple([linkUrl, probeOpts]), (url, opts) =>
    wrap<ProbeResult>(async () => {
      const route = routeLink(url);
      const s = d.settings.get();
      if (route === 'torrent') return d.jobs.probeTorrent(url.trim(), opts?.dir || s.dirTorrent);
      if (route === 'metalink') {
        const local = !/^[a-z]+:\/\//i.test(url);
        const name = path.basename(url.split(/[?#]/)[0]);
        if (local && !d.jobs.allowedLocal.has(url)) throw new AppError('PROBE_FAILED', 'Choose the file with a dialog first.');
        return { kind: 'metalink', url, filename: name.replace(/\.(meta4|metalink)$/i, ''), resumable: true, size: null, protocol: 'METALINK' };
      }
      if (route === 'ftp') return probeFtp(url);
      if (route === 'http') {
        const res = await probeHttp(url, opts?.headers);
        if (!res.error && res.filename) {
          const dir = opts?.dir || s.dirNormal;
          const target = path.join(dir, res.filename);
          res.exists = fs.existsSync(target) && !fs.existsSync(`${target}.aria2`);
        }
        return res;
      }
      throw new AppError('PROBE_FAILED', 'Links need to start with http://, https://, ftp://, sftp:// or magnet:');
    })
  );
  handle('job:add', z.tuple([addSchema]), (req) =>
    wrap(() => {
      if (req.kind !== 'media') return d.jobs.add(req);
      // Video jobs: the URL and captured headers come from the main process's own session, never the renderer.
      const m = req.media;
      const item = m && d.capture.item(m.sessionId, m.itemId);
      if (!m || !item) throw new AppError('PROBE_FAILED', 'This list of videos has closed. Fetch the page again.');
      return d.jobs.addMedia(item, m.quality, req.dir);
    })
  );
  handle('job:pause', z.tuple([id]), (i) => wrap(() => d.jobs.pause(i)));
  handle('job:resume', z.tuple([id]), (i) => wrap(() => d.jobs.resume(i)));
  handle('job:retry', z.tuple([id]), (i) => wrap(() => d.jobs.retry(i)));
  handle('job:cancel', z.tuple([id, z.boolean()]), (i, del) => wrap(() => d.jobs.cancel(i, del)));
  handle('job:setConnections', z.tuple([id, z.number().int().min(1).max(200)]), (i, n) => wrap(() => d.jobs.setConnections(i, n)));
  handle('job:clearCompleted', z.tuple([z.enum(['torrent', 'normal', 'videos'])]), (tab) => wrap(() => d.jobs.clearCompleted(tab)));
  handle('job:list', null, () => d.jobs.list().map((j) => ({ ...j, options: { ...j.options, headers: undefined } })));
  handle('job:reveal', z.tuple([id]), (i) => {
    const job = d.jobs.list().find((j) => j.id === i);
    if (!job) return;
    const target = job.files[0] ?? (job.outName ? path.join(job.dir, job.outName) : undefined);
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
    else void shell.openPath(job.dir);
  });

  // ---- settings
  handle('settings:get', null, () => d.settings.get());
  handle('settings:set', z.tuple([settingsPatchSchema]), (patch) => {
    const prev = d.settings.get();
    const next = d.settings.update(patch as Partial<Settings>);
    d.onSettingsChanged(prev, next);
    return next;
  });

  // ---- dialogs
  handle('dialog:pickFolder', z.tuple([z.string().max(4096).optional()]), async (start) => {
    const win = d.getWindow();
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: start };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle('dialog:pickTorrent', null, async () => {
    const win = d.getWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Torrent or Metalink', extensions: ['torrent', 'metalink', 'meta4'] },
        { name: 'All files', extensions: ['*'] }
      ]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = r.canceled ? null : (r.filePaths[0] ?? null);
    if (file) d.jobs.allowedLocal.add(file);
    return file;
  });

  // ---- V2: video capture
  const browserId = z.string().min(1).max(64);
  const iconCache = new Map<string, string>();
  const exeIcon = async (exe: string) => {
    if (!iconCache.has(exe)) iconCache.set(exe, (await app.getFileIcon(exe, { size: 'normal' })).toDataURL());
    return iconCache.get(exe);
  };
  handle('capture:browsers', null, () => d.capture.browsersWithIcons(exeIcon));
  handle('capture:addBrowser', null, async (): Promise<Browser | { error: 'NOT_CHROMIUM' } | null> => {
    const win = d.getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a Chromium-based browser',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }] : []
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    let file = r.canceled ? undefined : r.filePaths[0];
    if (!file) return null;
    // A macOS .app bundle: use the executable inside it.
    if (process.platform === 'darwin' && file.endsWith('.app')) file = path.join(file, 'Contents', 'MacOS', path.basename(file, '.app'));
    const known = d.settings.get().customBrowsers.find((b) => path.resolve(b.path) === path.resolve(file!));
    if (known) return { ...known, custom: true, icon: await exeIcon(known.path).catch(() => undefined) };
    const ok = await verifyBrowser(file);
    if (!ok) return { error: 'NOT_CHROMIUM' };
    d.settings.update({ customBrowsers: [...d.settings.get().customBrowsers, ok] });
    return { ...ok, custom: true, icon: await exeIcon(ok.path).catch(() => undefined) };
  });
  handle('capture:removeBrowser', z.tuple([browserId]), (bid) => {
    const s = d.settings.get();
    d.settings.update({ customBrowsers: s.customBrowsers.filter((b) => b.id !== bid), captureBrowser: s.captureBrowser === bid ? '' : s.captureBrowser });
    return d.settings.get();
  });
  handle('capture:start', z.tuple([z.object({ url: z.string().min(1).max(8192), browserId }).strict()]), (req) => d.capture.start(req.url, req.browserId));
  handle('capture:end', z.tuple([z.string().uuid()]), (sid) => d.capture.end(sid));
  handle('capture:discard', z.tuple([z.string().uuid()]), (sid) => d.capture.discard(sid));
  handle('capture:current', null, () => d.capture.current());
  handle('capture:clearData', null, () => d.capture.clearData());
  handle('engines:status', null, () => d.engines.status());
  handle('engines:checkYtdlp', null, () => d.engines.checkNow());

  // ---- engine
  handle('engine:status', null, () => d.daemon.status);
  handle('engine:restart', null, () => d.daemon.restart());
  handle('engine:openLog', null, async () => {
    if (fs.existsSync(d.daemon.logFile)) await shell.openPath(d.daemon.logFile);
    else await shell.openPath(path.dirname(d.daemon.logFile));
  });
  handle('engine:logTail', null, () => d.daemon.readLogTail(20));

  // ---- app / window
  handle('app:info', null, () => d.appInfo());
  handle('app:closeChoice', z.tuple([z.enum(['hide', 'quit', 'cancel'])]), (c) => d.onCloseChoice(c));
  handle('app:quit', null, () => d.quit());
  handle('app:takePendingLink', null, () => d.takePendingLink());
  handle('app:openExternal', z.tuple([z.string().max(2048)]), async (url) => {
    if (ALLOWED_EXTERNAL.test(url)) await shell.openExternal(url);
  });
  handle('win:minimize', null, () => d.getWindow()?.minimize());
  handle('win:toggleMaximize', null, () => {
    const w = d.getWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  handle('win:close', null, () => d.getWindow()?.close());
}
