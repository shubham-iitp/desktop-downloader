import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Browser as PBrowser, CDPSession, Target } from 'puppeteer-core';
import type { Browser, CaptureItem, CapturePhase, CaptureStartError, CaptureUpdate, QualityOption, VisitedPage } from '@shared/types';
import { detectBrowsers, waitDevToolsPort } from './browsers';
import {
  classifyResponse,
  defaultQuality,
  formatSize,
  hostOf,
  pagesToScan,
  parseDash,
  parseHls,
  shortUrl,
  singleQuality,
  sizeFromHeaders,
  streamQualities,
  stripQuery,
  toNetscapeCookies,
  ytdlpQualities,
  ytdlpUrls,
  type CdpCookie,
  type YtInfo
} from './classify';
import { scanPage } from '../ytdlp/ytdlp';
import { ffmpegPath, ffprobePath } from '../bin';
import { runHelper } from '../proc';
import { killTree, spawnHelper } from '../proc';
import type { SettingsStore } from '../settings';
import { log } from '../log';

/** Everything the app needs to turn a popup row into queue jobs. Never sent to the renderer. */
export interface ResolvedItem {
  id: string;
  type: CaptureItem['type'];
  title: string;
  /** yt-dlp: the entry's page URL. Captured: manifest or file URL. */
  url: string;
  pageUrl: string;
  qualities: QualityOption[];
  /** Captured items: Referer / Origin / User-Agent / Cookie as sent by the browser. */
  headers: string[];
  cookieFile?: string;
  size?: number;
  ext?: string;
}

interface Captured {
  url: string;
  type: 'hls' | 'dash' | 'progressive';
  /** Document the request came from (an embedded player's frame, or the tab itself). */
  pageUrl: string;
  /** The tab's page the user opened (its title names the stream). */
  topUrl: string;
  headers: Record<string, string>;
  size?: number;
  mime?: string;
  requestId: string;
}

const REPLAY_HEADERS = ['referer', 'origin', 'user-agent', 'cookie'];
const SCAN_CONCURRENCY = 3;
const COOKIE_EVERY_MS = 10_000;
const START_TIMEOUT_MS = 15_000;

function pickHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (REPLAY_HEADERS.includes(k.toLowerCase()) && typeof v === 'string') out[k.toLowerCase()] = v;
  return out;
}

const headerLines = (h: Record<string, string>) =>
  Object.entries(h).map(([k, v]) => `${k.replace(/(^|-)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())}: ${v.replace(/[\r\n]/g, '')}`);

async function fetchWith(
  url: string,
  headers: Record<string, string>,
  method: 'GET' | 'HEAD',
  maxBytes = 2_000_000
): Promise<{ ok: boolean; text?: string; type?: string; buf?: Buffer; length?: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    // Node's fetch, not net.fetch: the browser's own Cookie header has to be replayed exactly.
    const res = await fetch(url, { method, headers, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) return { ok: false };
    if (method === 'HEAD') return { ok: true, type: res.headers.get('content-type') ?? '', length: Number(res.headers.get('content-length')) || undefined };
    const len = Number(res.headers.get('content-length'));
    if (len > maxBytes) return { ok: false };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return { ok: false };
    return { ok: true, text: buf.toString('utf8'), buf, type: res.headers.get('content-type') ?? '' };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolution (ffprobe on the first segment, with the browser's headers) and an estimated size
 * (first segment's size × number of segments) of a single-quality HLS playlist.
 */
async function probeSegment(segments: string[], headers: Record<string, string>): Promise<{ height?: number; bytes?: number }> {
  const first = segments[0];
  if (!first || !/^https?:/i.test(first)) return {};
  const out: { height?: number; bytes?: number } = {};
  const head = await fetchWith(first, headers, 'HEAD');
  if (head.ok && head.length) out.bytes = head.length * segments.length;
  try {
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', ...ffHeaders(headers), first];
    const r = await runHelper(ffprobePath(), args, { timeoutMs: 20_000, lowPriority: true }).promise;
    const h = Number(r.stdout.trim().split(/\s+/)[0]);
    if (h > 0) out.height = h;
  } catch {
    /* no ffprobe, or the segment couldn't be read */
  }
  return out;
}

/** ffmpeg's -headers / -cookies arguments for the browser's captured headers. */
function ffHeaders(headers: Record<string, string>): string[] {
  const hdr = headerLines(headers).filter((l) => !/^cookie:/i.test(l)).join('\r\n');
  const out: string[] = [];
  if (hdr) out.push('-headers', `${hdr}\r\n`);
  if (headers.cookie) out.push('-cookies', headers.cookie);
  return out;
}

/** One frame of a captured stream as a small JPEG data: URL (ffmpeg, with the browser's headers). */
async function grabFrame(url: string, headers: Record<string, string>, tmpDir: string, at: number): Promise<string | undefined> {
  if (!/^https?:/i.test(url)) return undefined;
  fs.mkdirSync(tmpDir, { recursive: true });
  const out = path.join(tmpDir, `thumb-${crypto.randomUUID()}.jpg`);
  try {
    const args = ['-v', 'error', ...ffHeaders(headers), '-ss', String(at), '-i', url, '-frames:v', '1', '-vf', 'scale=256:-2', '-q:v', '6', '-y', out];
    let r = await runHelper(ffmpegPath(), args, { timeoutMs: 25_000, lowPriority: true }).promise;
    // A short first segment may end before `at`: take its first frame instead.
    if (!fs.existsSync(out)) r = await runHelper(ffmpegPath(), args.filter((a, i) => !(a === '-ss' || args[i - 1] === '-ss')), { timeoutMs: 25_000, lowPriority: true }).promise;
    void r;
    const buf = fs.readFileSync(out);
    return buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : undefined;
  } catch {
    return undefined;
  } finally {
    fs.rmSync(out, { force: true });
  }
}

/** Thumbnails become data: URLs, since the renderer loads nothing remote. */
async function thumbnailData(url: string | null | undefined): Promise<string | undefined> {
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  const r = await fetchWith(url, {}, 'GET', 400_000);
  if (!r.ok || !r.buf || !/^image\/(jpeg|png|webp|gif)/i.test(r.type ?? '')) return undefined;
  return `data:${r.type!.split(';')[0]};base64,${r.buf.toString('base64')}`;
}

/**
 * The app-owned profile always starts with just the pasted link: open the New Tab page on
 * startup (never "continue where you left off"), treat the last exit as clean so no tabs are
 * restored in a second, hidden window, and don't keep running in the background after the
 * last window closes (that would keep the session from ending).
 */
function quietProfile(profile: string): void {
  const file = path.join(profile, 'Default', 'Preferences');
  let prefs: Record<string, Record<string, unknown>> = {};
  try {
    prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first run: the browser fills in the rest */
  }
  prefs.session = { ...(prefs.session ?? {}), restore_on_startup: 5 };
  prefs.profile = { ...(prefs.profile ?? {}), exit_type: 'Normal', exited_cleanly: true };
  prefs.background_mode = { ...(prefs.background_mode ?? {}), enabled: false };
  // Saved tabs from earlier sessions (what a browser restores on start). Logins and cookies
  // live elsewhere in the profile and are kept.
  for (const f of ['Sessions', 'Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
    fs.rmSync(path.join(profile, 'Default', f), { recursive: true, force: true });
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(prefs));
  } catch (e) {
    log.warn('capture: could not update profile preferences', e);
  }
}

class Session {
  readonly id = crypto.randomUUID();
  phase: CapturePhase = 'starting';
  child?: ChildProcess;
  browser?: PBrowser;
  visited: string[] = [];
  captured = new Map<string, Captured>();
  /** Page URL → the tab's title, used to name captured streams. */
  titles = new Map<string, string>();
  /** The page most recently opened in a tab: embedded players' streams belong to it. */
  topPage = '';
  /** Captured rows that are one HLS media playlist / a multi-quality playlist, for dropping duplicates. */
  singles = new Map<string, { page: string; duration?: number }>();
  masters = new Map<string, { page: string; duration?: number }>();
  mediaSeen = 0;
  cookieFile: string;
  items = new Map<string, ResolvedItem>();
  rows = new Map<string, CaptureItem>();
  /** URLs yt-dlp found, for dropping captured duplicates. */
  ytUrls = new Set<string>();
  /** Row ids the user has queued: never removed by a later merge. */
  taken = new Set<string>();
  pasteScan: 'pending' | number = 'pending';
  /** True once the app has opened the session's window (the browser starts without one). */
  shown = false;
  scanTotal = 1;
  scanDone = 0;
  pending = 0;
  timers: NodeJS.Timeout[] = [];
  private seq = 0;

  constructor(
    readonly url: string,
    readonly browserInfo: Browser,
    tmpDir: string
  ) {
    this.cookieFile = path.join(tmpDir, `cookies-${this.id}.txt`);
  }

  nextId(prefix: string) {
    return `${prefix}${++this.seq}`;
  }
}

/**
 * V2 Fetch videos: launches a Chromium browser on the pasted link with an app-owned profile,
 * watches its network traffic over CDP, and when the session ends merges what it saw with
 * yt-dlp scans of every page visited. Emits 'update' (CaptureUpdate) for the renderer.
 */
export class CaptureManager extends EventEmitter {
  private session?: Session;
  private emitTimer?: NodeJS.Timeout;
  private lastBrowsers: Browser[] = [];

  constructor(
    private userData: string,
    private settings: SettingsStore
  ) {
    super();
    this.cleanTmp();
  }

  get tmpDir() {
    return path.join(this.userData, 'tmp');
  }

  get profilesDir() {
    return path.join(this.userData, 'capture-profiles');
  }

  get running(): boolean {
    return !!this.session && (this.session.phase === 'starting' || this.session.phase === 'browsing');
  }

  async browsers(): Promise<Browser[]> {
    this.lastBrowsers = await detectBrowsers(this.settings.get().customBrowsers);
    return this.lastBrowsers;
  }

  /** Browsers with their own icons (from the executable) for the picker. */
  async browsersWithIcons(icon: (exe: string) => Promise<string | undefined>): Promise<Browser[]> {
    const list = await this.browsers();
    return Promise.all(list.map(async (b) => ({ ...b, icon: await icon(b.path).catch(() => undefined) })));
  }

  current(): CaptureUpdate | null {
    return this.session ? this.snapshot(this.session) : null;
  }

  async start(url: string, browserId: string): Promise<{ sessionId: string } | { error: CaptureStartError; message?: string }> {
    if (this.running) return { error: 'BUSY' };
    let u: URL;
    try {
      u = new URL(url.trim());
    } catch {
      return { error: 'BAD_URL' };
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'BAD_URL' };
    const list = await this.browsers();
    if (!list.length) return { error: 'NO_BROWSER' };
    const b = list.find((x) => x.id === browserId) ?? list[0];

    fs.mkdirSync(this.tmpDir, { recursive: true });
    const s = new Session(u.toString(), b, this.tmpDir);
    this.discardOld();
    this.session = s;
    this.emitSoon();

    const profile = path.join(this.profilesDir, b.id.replace(/[^a-z0-9-]/gi, '_'));
    fs.mkdirSync(profile, { recursive: true });
    fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
    quietProfile(profile);
    // The URL is checked to be http(s) above, so it can't be read as a browser flag.
    s.child = spawnHelper(
      b.path,
      [
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        // If an earlier session didn't shut down cleanly, don't offer to restore its tabs.
        '--hide-crash-restore-bubble',
        // No window of its own (which some browsers open hidden, or alongside restored tabs):
        // the app opens exactly one window with the link once it's connected.
        '--no-startup-window'
      ],
      {
      stdio: 'ignore',
      detached: false
      }
    );
    let exited = false;
    s.child.once('exit', () => {
      exited = true;
      if (s.phase === 'browsing') void this.end(s.id);
    });
    s.child.once('error', () => (exited = true));

    const port = await waitDevToolsPort(profile, START_TIMEOUT_MS, () => !exited);
    if (!port) {
      await killTree(s.child);
      this.session = undefined;
      this.emitSoon();
      return { error: 'NO_START', message: `Couldn’t start ${b.name}. Close it if it’s stuck and try again.` };
    }
    try {
      // ESM-only package: loaded with import() from the CJS main bundle.
      const { connect } = await import('puppeteer-core');
      s.browser = await connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null, protocolTimeout: 30_000 });
    } catch (e) {
      log.warn('capture: connect failed', e);
      await killTree(s.child);
      this.session = undefined;
      this.emitSoon();
      return { error: 'NO_START', message: `Couldn’t start ${b.name}. Close it if it’s stuck and try again.` };
    }
    s.phase = 'browsing';
    const br = s.browser;
    br.on('disconnected', () => void this.end(s.id));
    br.on('targetcreated', (t: Target) => void this.attach(s, t));
    br.on('targetdestroyed', () => {
      if (s.phase !== 'browsing' || !br.connected || !s.shown) return;
      const pages = br.targets().filter((t) => t.type() === 'page').length;
      // macOS keeps the browser running with no windows: end it ourselves.
      if (pages === 0) void this.end(s.id);
    });
    for (const t of br.targets()) void this.attach(s, t);
    await this.showBrowser(s).catch((e) => {
      s.shown = true; // the user's own windows still end the session when closed
      log.warn('capture: opening the window failed', e);
    });
    void this.snapshotCookies(s);
    s.timers.push(setInterval(() => void this.snapshotCookies(s), COOKIE_EVERY_MS));

    // yt-dlp gets a head start on the pasted link while the user browses.
    s.pending++;
    void scanPage(s.url)
      .then((infos) => this.addYtdlp(s, infos, s.url))
      .catch((e) => log.warn('capture: paste scan failed', e))
      .finally(() => {
        s.pasteScan = [...s.rows.values()].filter((r) => r.type === 'ytdlp').length;
        s.scanDone++;
        s.pending--;
        this.settle(s);
      });
    this.emitSoon();
    return { sessionId: s.id };
  }

  /** End session: button, last window closed, process exit or a dropped connection. */
  async end(sessionId: string): Promise<void> {
    const s = this.session;
    if (!s || s.id !== sessionId || s.phase !== 'browsing') return;
    s.phase = 'scanning';
    for (const t of s.timers) clearInterval(t);
    s.timers = [];
    this.emitSoon();
    if (s.browser?.connected) {
      await this.snapshotCookies(s).catch(() => {});
      // Close the tabs first (like closing the window), so the browser has nothing to restore.
      for (const p of await s.browser.pages().catch(() => [])) await p.close().catch(() => {});
      await s.browser.close().catch(() => {});
    }
    // Let the browser exit on its own so its profile is saved cleanly; a forced kill makes it
    // restore old tabs next time. Kill it only if it's still running after 10 s.
    const child = s.child;
    if (child && child.exitCode == null) {
      const t = setTimeout(() => void killTree(child), 10_000);
      child.once('exit', () => clearTimeout(t));
    }

    // Captured streams: read their manifests and check them.
    for (const c of s.captured.values()) {
      s.pending++;
      void this.addCaptured(s, c)
        .catch((e) => log.warn('capture: manifest check failed', e))
        .finally(() => {
          s.pending--;
          this.settle(s);
        });
    }
    // Every other page visited: yt-dlp, 3 at a time, with the session's cookies.
    const pages = pagesToScan(s.visited, s.url);
    s.scanTotal = 1 + pages.length;
    const cookies = fs.existsSync(s.cookieFile) ? s.cookieFile : undefined;
    let next = 0;
    const worker = async () => {
      while (next < pages.length && this.session === s) {
        const page = pages[next++];
        try {
          this.addYtdlp(s, await scanPage(page, cookies), page);
        } catch (e) {
          log.warn('capture: scan failed', e);
        }
        s.scanDone++;
        this.emitSoon();
      }
    };
    s.pending++;
    void Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker)).finally(() => {
      s.pending--;
      this.settle(s);
    });
    this.settle(s);
  }

  /** The popup was closed: forget its rows. The cookies file stays while queued jobs need it. */
  discard(sessionId: string): void {
    if (this.session?.id !== sessionId || this.running) return;
    this.session = undefined;
    this.emitSoon();
  }

  /** The open session (browsing or its popup) still writes or needs this cookies file. */
  cookieInUse(file: string): boolean {
    return this.session?.cookieFile === file;
  }

  item(sessionId: string, itemId: string): ResolvedItem | undefined {
    const s = this.session;
    if (!s || s.id !== sessionId) return undefined;
    const it = s.items.get(itemId);
    if (it) s.taken.add(itemId);
    return it;
  }

  async shutdown(): Promise<void> {
    const s = this.session;
    if (!s) return;
    for (const t of s.timers) clearInterval(t);
    await s.browser?.close().catch(() => {});
    if (s.child) await killTree(s.child);
  }

  /** Settings › Clear capture browser data: deletes capture-profiles/ (logins made there). */
  clearData(): boolean {
    if (this.running) return false;
    fs.rmSync(this.profilesDir, { recursive: true, force: true });
    return true;
  }

  // ---------------------------------------------------------------- monitoring

  private async attach(s: Session, t: Target): Promise<void> {
    const type = t.type();
    if (!['page', 'other', 'service_worker', 'shared_worker', 'webview'].includes(type)) return;
    let cdp: CDPSession;
    try {
      cdp = await t.createCDPSession();
    } catch {
      return; // closed already, or not attachable
    }
    const reqs = new Map<string, Record<string, string>>();
    let pageUrl = type === 'page' ? t.url() : '';
    let readTitle = async (): Promise<void> => {};
    cdp.on('Network.requestWillBeSent', (e) => {
      reqs.set(e.requestId, { ...(reqs.get(e.requestId) ?? {}), ...pickHeaders(e.request.headers as Record<string, string>) });
      if (e.documentURL && !pageUrl) pageUrl = e.documentURL;
    });
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
      const h = pickHeaders(e.headers as Record<string, string>);
      reqs.set(e.requestId, { ...(reqs.get(e.requestId) ?? {}), ...h });
      for (const c of s.captured.values()) if (c.requestId === e.requestId) c.headers = { ...c.headers, ...h };
    });
    cdp.on('Network.responseReceived', (e) => {
      const r = e.response;
      const size = sizeFromHeaders(r.headers as Record<string, string>);
      const kind = classifyResponse({ url: r.url, mimeType: r.mimeType, status: r.status, size });
      if (!kind) return;
      s.mediaSeen++;
      if (kind === 'segment') return; // only tied to playback, never listed
      const key = stripQuery(r.url);
      void readTitle();
      if (!s.captured.has(key)) {
        const top = type === 'page' ? pageUrl || s.url : s.topPage || pageUrl || s.url;
        s.captured.set(key, { url: r.url, type: kind, pageUrl: pageUrl || s.url, topUrl: top, headers: reqs.get(e.requestId) ?? {}, size, mime: r.mimeType, requestId: e.requestId });
      }
      this.emitSoon();
    });
    const drop = (e: { requestId: string }) => reqs.delete(e.requestId);
    cdp.on('Network.loadingFinished', drop);
    cdp.on('Network.loadingFailed', drop);
    if (type === 'page') {
      // The tab title names captured streams. Pages (and players) often set it late, so it's
      // read on load, a few seconds after each navigation, and whenever media turns up.
      readTitle = async () => {
        try {
          const r = (await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })) as { result: { value?: unknown } };
          const t = String(r.result.value ?? '').replace(/\s+/g, ' ').trim();
          if (t && pageUrl) s.titles.set(pageUrl, t.slice(0, 200));
        } catch {
          /* page closing */
        }
      };
      cdp.on('Page.loadEventFired', () => void readTitle());
      cdp.on('Page.frameNavigated', (e) => {
        if (e.frame.parentId) return;
        pageUrl = e.frame.url;
        if (/^https?:/i.test(pageUrl)) s.topPage = pageUrl;
        setTimeout(() => void readTitle(), 3000);
        if (/^https?:/i.test(pageUrl) && s.visited[s.visited.length - 1] !== pageUrl) s.visited.push(pageUrl);
        void this.snapshotCookies(s);
        this.emitSoon();
      });
      if (/^https?:/i.test(pageUrl) && !s.visited.includes(pageUrl)) s.visited.push(pageUrl);
    }
    try {
      await cdp.send('Network.enable');
      if (type === 'page') await cdp.send('Page.enable');
    } catch {
      /* target went away */
    }
  }

  /**
   * Windows often opens a program started by another app behind that app, or the browser may
   * restore a minimised window. Make sure a tab with the pasted link exists, un-minimise its
   * window and activate it (Chromium's own activation gets past the foreground lock).
   */
  private async showBrowser(s: Session): Promise<void> {
    const br = s.browser;
    if (!br) return;
    if (!s.visited.includes(s.url)) s.visited.push(s.url);
    // With --no-startup-window there's no window yet, so this opens exactly one.
    const page = await br.newPage();
    // Anything else the browser opened by itself (restored tabs, a welcome page) is closed.
    for (const p of await br.pages()) if (p !== page) await p.close().catch(() => {});
    // For a few seconds, also close tabs the browser restores by itself (no opener). Pop-ups a
    // site opens later have an opener and are left alone.
    const ours = page.target();
    const stray = (t: Target) => {
      if (t.type() === 'page' && t !== ours && !t.opener()) void t.page().then((p) => p?.close().catch(() => {}));
    };
    br.on('targetcreated', stray);
    setTimeout(() => br.off('targetcreated', stray), 6000);
    // Don't wait for the page to load: show the window straight away.
    void page.goto(s.url, { timeout: 60_000 }).catch(() => {});
    const cdp = await page.createCDPSession();
    try {
      const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
      const { bounds } = (await cdp.send('Browser.getWindowBounds', { windowId })) as { bounds: { windowState?: string } };
      if (bounds.windowState === 'minimized') await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    } finally {
      await cdp.detach().catch(() => {});
    }
    s.shown = true;
    await page.bringToFront();
  }

  /** Cookies can't be read after the browser closes, so they're saved as we go. */
  private async snapshotCookies(s: Session): Promise<void> {
    const br = s.browser;
    if (!br?.connected) return;
    try {
      const cdp = await br.target().createCDPSession();
      const { cookies } = (await cdp.send('Storage.getCookies')) as { cookies: CdpCookie[] };
      await cdp.detach().catch(() => {});
      fs.writeFileSync(s.cookieFile, toNetscapeCookies(cookies), { mode: 0o600 });
    } catch {
      /* browser closing */
    }
  }

  // ---------------------------------------------------------------- results

  private addYtdlp(s: Session, infos: YtInfo[], page: string): void {
    if (this.session !== s) return;
    for (const info of infos) {
      const qualities = ytdlpQualities(info);
      if (!qualities.length) continue; // DRM only: skipped silently
      const link = info.webpage_url || info.original_url || info.url;
      if (!link) continue;
      if ([...s.items.values()].some((x) => x.type === 'ytdlp' && x.url === link)) continue;
      for (const u of ytdlpUrls(info)) s.ytUrls.add(u);
      const id = s.nextId('y');
      const host = hostOf(link);
      const found = hostOf(page) !== host ? `${host} · found on ${shortUrl(page)}` : host;
      s.items.set(id, { id, type: 'ytdlp', title: info.title || host, url: link, pageUrl: page, qualities, headers: [], cookieFile: s.cookieFile });
      s.rows.set(id, { id, type: 'ytdlp', title: info.title || host, source: found, duration: info.duration ?? undefined, qualities, defaultQuality: defaultQuality(qualities) });
      void thumbnailData(info.thumbnail).then((t) => {
        const row = s.rows.get(id);
        if (t && row) {
          row.thumbnail = t;
          this.emitSoon();
        }
      });
    }
    // yt-dlp's entry wins over a captured copy of the same stream.
    for (const [id, it] of s.items) {
      if (it.type !== 'ytdlp' && !s.taken.has(id) && s.ytUrls.has(stripQuery(it.url))) {
        s.items.delete(id);
        s.rows.delete(id);
      }
    }
    this.emitSoon();
  }

  private async addCaptured(s: Session, c: Captured): Promise<void> {
    if (s.ytUrls.has(stripQuery(c.url))) return;
    const host = hostOf(c.url);
    let single = false;
    let master = false;
    /** What ffmpeg grabs the thumbnail frame from. */
    let frameFrom: string | undefined;
    let qualities: QualityOption[];
    let duration: number | undefined;
    let sourceKind: string;
    if (c.type === 'hls') {
      const r = await fetchWith(c.url, c.headers, 'GET');
      if (!r.ok || !r.text?.includes('#EXTM3U')) return;
      const info = parseHls(r.text, c.url);
      if (info.drm) return;
      if (info.master) {
        // A variant URL another capture is the master's own child: list the master only.
        for (const v of info.variants) {
          const k = stripQuery(v.url);
          for (const [id, it] of s.items) if (stripQuery(it.url) === k && !s.taken.has(id)) (s.items.delete(id), s.rows.delete(id));
          s.ytUrls.add(k); // so a later-processed child is skipped too
        }
        // Keys live in the media playlists: check the top variant for DRM and read its length.
        const top = [...info.variants].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
        const child = top ? await fetchWith(top.url, c.headers, 'GET') : undefined;
        if (child?.text) {
          const ci = parseHls(child.text, top.url);
          frameFrom = ci.segments[0];
          if (ci.drm) return;
          duration = ci.duration;
        }
        qualities = streamQualities(info.variants, duration);
        master = true;
      } else {
        // One quality only: read its resolution from the first segment and estimate its size.
        duration = info.duration;
        const probe = await probeSegment(info.segments, c.headers);
        frameFrom = info.segments[0];
        qualities = [singleQuality(probe.height, probe.bytes)];
        single = true;
      }
      sourceKind = 'HLS';
    } else if (c.type === 'dash') {
      const r = await fetchWith(c.url, c.headers, 'GET');
      if (!r.ok || !r.text || !/<(?:[\w-]+:)?MPD\b/i.test(r.text)) return;
      const info = parseDash(r.text);
      if (info.drm) return;
      duration = info.duration;
      qualities = streamQualities(info.representations.filter((x) => x.kind === 'video'), duration);
      sourceKind = 'DASH';
    } else {
      const r = await fetchWith(c.url, c.headers, 'HEAD');
      if (!r.ok) return;
      const ext = (stripQuery(c.url).match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? (c.mime?.split('/')[1] || 'mp4')).toLowerCase();
      qualities = [{ key: 'file', label: `${ext.toUpperCase()} · single file`, size: formatSize(c.size) }];
      sourceKind = `${ext.toUpperCase()} file`;
    }
    if (this.session !== s || s.ytUrls.has(stripQuery(c.url))) return;
    // A player often loads the list of qualities and one of its playlists directly: same page,
    // same length. Keep the multi-quality one.
    const same = (a?: number, b?: number) => !!a && !!b && Math.abs(a - b) < 2;
    if (single && [...s.masters.values()].some((m) => m.page === c.topUrl && same(m.duration, duration))) return;
    if (master) {
      for (const [sid, m] of s.singles) {
        if (m.page === c.topUrl && same(m.duration, duration) && !s.taken.has(sid)) (s.items.delete(sid), s.rows.delete(sid), s.singles.delete(sid));
      }
    }
    const title = this.pageTitle(s, c.topUrl) ?? this.pageTitle(s, c.pageUrl) ?? `Captured stream from ${host}`;
    const id = s.nextId('c');
    if (single) s.singles.set(id, { page: c.topUrl, duration });
    if (master) s.masters.set(id, { page: c.topUrl, duration });
    const ext = c.type === 'progressive' ? qualities[0].label.split(' ')[0].toLowerCase() : 'mp4';
    s.items.set(id, { id, type: c.type, title, url: c.url, pageUrl: c.topUrl, qualities, headers: headerLines(c.headers), cookieFile: s.cookieFile, size: c.size, ext });
    s.rows.set(id, { id, type: c.type, title, source: `${sourceKind} · ${shortUrl(c.topUrl)}`, duration, qualities, defaultQuality: defaultQuality(qualities) });
    // Captured streams have no thumbnail of their own: grab a frame (shown when it's ready).
    if (c.type !== 'hls' || frameFrom) {
      void grabFrame(frameFrom ?? c.url, c.headers, this.tmpDir, c.type === 'progressive' ? 5 : 1).then((t) => {
        const row = s.rows.get(id);
        if (t && row) {
          row.thumbnail = t;
          this.emitSoon();
        }
      });
    }
    this.emitSoon();
  }

  /** The page's title for a captured stream: "Page title", then "Page title (2)" for more on that page. */
  private pageTitle(s: Session, pageUrl: string): string | undefined {
    const base = s.titles.get(pageUrl);
    if (!base) return undefined;
    const taken = new Set([...s.rows.values()].map((r) => r.title));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
  }

  private settle(s: Session): void {
    if (s.phase === 'scanning' && s.pending === 0) s.phase = 'done';
    this.emitSoon();
  }

  private snapshot(s: Session): CaptureUpdate {
    const mediaPages = new Map<string, string>();
    for (const c of s.captured.values()) if (!mediaPages.has(c.pageUrl)) mediaPages.set(c.pageUrl, c.type === 'progressive' ? 'MP4 seen' : `${c.type.toUpperCase()} seen`);
    const pages: VisitedPage[] = [...new Set(s.visited)].slice(-12).map((u) => {
      const seen = mediaPages.get(u);
      if (seen) return { url: shortUrl(u), tag: seen, ok: true };
      if (u === s.url && s.pasteScan !== 'pending') {
        const n = s.pasteScan;
        return { url: shortUrl(u), tag: n ? `yt-dlp: ${n} video${n === 1 ? '' : 's'}` : 'yt-dlp: none yet', ok: n > 0 };
      }
      return { url: shortUrl(u), tag: s.phase === 'browsing' ? 'yt-dlp after session' : '', ok: false };
    });
    return {
      sessionId: s.id,
      phase: s.phase,
      url: s.url,
      browserId: s.browserInfo.id,
      browserName: s.browserInfo.name,
      pages,
      mediaSeen: s.mediaSeen,
      progress: { done: Math.min(s.scanDone, s.scanTotal), total: s.scanTotal },
      items: [...s.rows.values()]
    };
  }

  private emitSoon(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      this.emit('update', this.session ? this.snapshot(this.session) : null);
    }, 300);
  }

  private discardOld(): void {
    this.session = undefined;
  }

  /** Cookie files older than 24 h are removed (tech doc: V2 security). */
  private cleanTmp(): void {
    try {
      for (const f of fs.readdirSync(this.tmpDir)) {
        const p = path.join(this.tmpDir, f);
        if (/^cookies-.*\.txt$/.test(f) && Date.now() - fs.statSync(p).mtimeMs > 86_400_000) fs.rmSync(p, { force: true });
      }
    } catch {
      /* no tmp dir yet */
    }
  }
}
