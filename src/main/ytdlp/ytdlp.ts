import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { net } from 'electron';
import type { EngineInfo, EnginesStatus } from '@shared/types';
import { binDir, bundledYtdlp, denoPath, ffmpegPath, updatedYtdlp, ytdlpPath, ytdlpUpdateDir } from '../bin';
import { runHelper } from '../proc';
import { log } from '../log';
import type { YtInfo } from '../capture/classify';

/** Arguments every yt-dlp call gets (tech doc: ignore user config, bundled Deno and ffmpeg). */
export function baseArgs(): string[] {
  return ['--ignore-config', '--no-color', '--js-runtimes', `deno:${denoPath()}`, '--ffmpeg-location', binDir];
}

const MAX_ENTRIES = 25;

async function dumpJson(url: string, cookieFile: string | undefined, flat: boolean, timeoutMs: number): Promise<YtInfo | undefined> {
  const args = [...baseArgs(), '-J', '--no-progress', ...(flat ? ['--flat-playlist'] : []), ...(cookieFile ? ['--cookies', cookieFile] : []), '--', url];
  const { promise } = runHelper(ytdlpPath(), args, { timeoutMs, lowPriority: true });
  const r = await promise;
  if (r.code !== 0 || !r.stdout.trim()) {
    const msg = r.stderr.split(/\r?\n/).find((l) => l.startsWith('ERROR:'));
    if (msg) log.info(`yt-dlp scan: ${msg.slice(0, 300)}`);
    return undefined;
  }
  try {
    return JSON.parse(r.stdout) as YtInfo;
  } catch {
    return undefined;
  }
}

/**
 * Scans a page: `-J --flat-playlist`, then `-J` per entry for its formats. Unsupported pages,
 * private or geo-blocked videos simply return nothing (the popup never shows them).
 */
export async function scanPage(url: string, cookieFile?: string): Promise<YtInfo[]> {
  const top = await dumpJson(url, cookieFile, true, 90_000);
  if (!top) return [];
  if (top._type !== 'playlist' || !top.entries) return top.formats?.length || top.url ? [top] : [];
  const out: YtInfo[] = [];
  for (const e of top.entries.slice(0, MAX_ENTRIES)) {
    if (!e) continue;
    if (e.formats?.length) {
      out.push(e);
      continue;
    }
    const link = e.webpage_url || e.url;
    if (!link || !/^https?:\/\//i.test(link)) continue;
    const full = await dumpJson(link, cookieFile, false, 90_000);
    if (full?.formats?.length || full?.url) out.push({ ...full, original_url: url });
  }
  return out;
}

// ---------------------------------------------------------------- versions and updates

const DAY = 86_400_000;

async function versionOf(bin: string, args: string[], pick: (out: string) => string | undefined): Promise<string | undefined> {
  if (!fs.existsSync(bin)) return undefined;
  try {
    const r = await runHelper(bin, args, { timeoutMs: 20_000 }).promise;
    return r.code === 0 ? pick(r.stdout) : undefined;
  } catch {
    return undefined;
  }
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** The asset name of yt-dlp's standalone build for this platform. */
function releaseAsset(): string | undefined {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return undefined;
}

/**
 * Tracks the yt-dlp / ffmpeg / Deno versions for Settings › Engines, and keeps yt-dlp current:
 * at most once a day it downloads the latest release into userData/bin, checks its SHA-256
 * against the release's SHA2-256SUMS, and uses it in preference to the bundled copy.
 */
export class Engines {
  private cache?: EnginesStatus;
  private checking = false;
  private note = 'Checks for a new release once a day and verifies its SHA-256 before using it.';

  constructor(
    private getLastCheck: () => number,
    private setLastCheck: (t: number) => void,
    private onChange: (s: EnginesStatus) => void
  ) {}

  async status(refresh = false): Promise<EnginesStatus> {
    if (this.cache && !refresh) return { ...this.cache, ytdlp: { ...this.cache.ytdlp, checking: this.checking, note: this.note } };
    const yt = ytdlpPath();
    const [ytv, ffv, dv] = await Promise.all([
      versionOf(yt, ['--version'], (o) => o.trim().split(/\s+/)[0]),
      versionOf(ffmpegPath(), ['-version'], (o) => o.match(/ffmpeg version (\S+)/)?.[1]?.replace(/-essentials.*$/, '')),
      versionOf(denoPath(), ['--version'], (o) => o.match(/deno (\S+)/)?.[1])
    ]);
    const info = (name: string, p: string, v: string | undefined, updated = false): EngineInfo => ({
      name,
      version: v ?? '—',
      source: updated ? 'Updated copy' : 'Bundled',
      ready: !!v,
      path: p
    });
    this.cache = {
      ytdlp: { ...info('yt-dlp', yt, ytv, yt === updatedYtdlp()), checking: this.checking, note: this.note },
      ffmpeg: info('ffmpeg', ffmpegPath(), ffv),
      deno: info('Deno', denoPath(), dv)
    };
    return this.cache;
  }

  /** Daily background check, run shortly after startup. */
  maybeAutoUpdate(): void {
    if (Date.now() - this.getLastCheck() < DAY) return;
    setTimeout(() => void this.checkNow().catch((e) => log.warn('yt-dlp update check failed', e)), 60_000);
  }

  async checkNow(): Promise<EnginesStatus> {
    if (this.checking) return this.status();
    this.checking = true;
    this.onChange(await this.status());
    try {
      const msg = await this.update();
      this.note = msg;
      this.setLastCheck(Date.now());
    } catch (e) {
      this.note = `Couldn’t check for a new release: ${(e as Error).message}`;
    } finally {
      this.checking = false;
    }
    const s = await this.status(true);
    this.onChange(s);
    return s;
  }

  private async update(): Promise<string> {
    const asset = releaseAsset();
    if (!asset) return 'Updates aren’t available for this platform.';
    const res = await net.fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DesktopDownloader' }
    });
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
    const rel = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
    const current = (await this.status(true)).ytdlp.version;
    if (current === rel.tag_name) return 'Up to date · checked just now';
    const bin = rel.assets.find((a) => a.name === asset);
    const sums = rel.assets.find((a) => a.name === 'SHA2-256SUMS');
    if (!bin || !sums) throw new Error('the release has no build for this platform');
    const sumText = await (await net.fetch(sums.browser_download_url)).text();
    const expected = sumText
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .find(([, n]) => n === asset)?.[0];
    if (!expected) throw new Error('no checksum listed for this build');
    const data = Buffer.from(await (await net.fetch(bin.browser_download_url)).arrayBuffer());
    if (sha256(data) !== expected.toLowerCase()) throw new Error('the download didn’t match its published SHA-256');
    fs.mkdirSync(ytdlpUpdateDir(), { recursive: true });
    const dest = updatedYtdlp();
    const tmp = `${dest}.download`;
    fs.writeFileSync(tmp, data, { mode: 0o755 });
    try {
      fs.renameSync(tmp, dest);
    } catch {
      // Windows can't replace an exe that's running: try again on the next check.
      fs.rmSync(tmp, { force: true });
      return `${rel.tag_name} is available · it installs once no video downloads are running`;
    }
    log.info(`yt-dlp updated to ${rel.tag_name} (${path.basename(dest)})`);
    return `Updated to ${rel.tag_name} just now · SHA-256 verified`;
  }
}

export { bundledYtdlp };
