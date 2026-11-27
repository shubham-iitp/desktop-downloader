import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import path from 'node:path';
import readline from 'node:readline';
import type { ErrorCode, Job } from '@shared/types';
import { mapYtdlpError, parseYtLine, postNote, POST_PREFIX, PROGRESS_PREFIX, safeHlsMaster, ytdlpFormatArgs } from '../capture/classify';
import { ytdlpPath } from '../bin';
import { killTree, spawnHelper } from '../proc';
import { baseArgs } from './ytdlp';
import { log } from '../log';

/** yt-dlp jobs that run at once (tech doc: an in-app limit of 3, alongside aria2's own). */
export const VIDEO_SLOTS = 3;
/** Segments of one video downloaded at once (yt-dlp --concurrent-fragments). */
export const CONCURRENT_FRAGMENTS = 4;

export interface RunnerHooks {
  list(): Job[];
  /** Progress or a postprocessing note changed (not a status change). */
  progress(job: Job): void;
  started(job: Job): void;
  postprocessing(job: Job, note: string): void;
  finished(job: Job, filePath: string | undefined): void;
  failed(job: Job, code: ErrorCode, message: string, detail: string): void;
}

/** yt-dlp output templates treat % specially. */
const escapeTemplate = (s: string) => s.replace(/%/g, '%%');

/** The command line for a video job (also shown in Copy details). */
export function ytdlpArgs(job: Job, url = job.url): string[] {
  const m = job.media!;
  const base = (job.outName ?? job.title).replace(/\.[a-z0-9]{2,4}$/i, '');
  const args = [
    ...baseArgs(),
    '--newline',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_PREFIX}%(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,speed,eta,filename})j`,
    '--progress-template',
    `postprocess:${POST_PREFIX}%(progress.{status,postprocessor})j`,
    '--print',
    'after_move:filepath',
    '--continue',
    // HLS / DASH and other segmented formats: 4 segments at a time instead of 1.
    '--concurrent-fragments',
    String(CONCURRENT_FRAGMENTS),
    '--no-mtime',
    '--no-playlist',
    '-P',
    job.dir,
    '-o',
    `${escapeTemplate(base)}.%(ext)s`,
    ...ytdlpFormatArgs(m.quality)
  ];
  if (m.cookieFile && fs.existsSync(m.cookieFile)) args.push('--cookies', m.cookieFile);
  for (const h of job.options.headers ?? []) {
    // Cookies go through the cookies file; the other captured headers are replayed as sent.
    if (!/^cookie\s*:/i.test(h)) args.push('--add-header', h.replace(/\s*:\s*/, ':'));
  }
  if (url.startsWith('file:')) args.push('--enable-file-urls');
  args.push('--', url);
  return args;
}

interface Run {
  child: ChildProcess;
  stopped: boolean;
  lastError: string;
  stderrTail: string[];
  filePath?: string;
  /** Bytes of earlier streams (video then audio) that already finished. */
  doneBefore: number;
  currentFile?: string;
  currentTotal: number;
}

/**
 * Runs yt-dlp video jobs, one child process each, at most VIDEO_SLOTS at a time. Captured
 * jobs start first: their links are signed and expire within hours. Pause and cancel kill
 * the process tree; resume re-runs the command and yt-dlp continues from its .part files.
 */
export class MediaRunner {
  private runs = new Map<string, Run>();
  /** Jobs whose playlist copy is being prepared; they hold a slot already. */
  private starting = new Set<string>();

  constructor(private hooks: RunnerHooks) {}

  get busy(): number {
    return this.runs.size + this.starting.size;
  }

  isRunning(id: string): boolean {
    return this.runs.has(id);
  }

  /** Starts queued video jobs while slots are free. */
  schedule(): void {
    const waiting = this.hooks
      .list()
      .filter((j) => j.engine === 'ytdlp' && j.status === 'queued' && !this.runs.has(j.id) && !this.starting.has(j.id))
      .sort((a, b) => Number(b.media?.source === 'captured') - Number(a.media?.source === 'captured') || a.createdAt - b.createdAt);
    for (const job of waiting) {
      if (this.busy >= VIDEO_SLOTS) break;
      this.starting.add(job.id);
      void this.prepare(job).then((url) => {
        this.starting.delete(job.id);
        if (job.status === 'queued') this.start(job, url);
        else this.schedule(); // paused or removed while preparing
      });
    }
  }

  /** Kills a running job (pause or cancel). Its exit isn't reported as a failure. */
  async stop(id: string): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    run.stopped = true;
    await killTree(run.child);
    this.runs.delete(id);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }

  /**
   * Captured HLS streams: yt-dlp gets a local copy of the playlist with Windows-safe track names
   * (see safeHlsMaster). Anything else, or if the playlist can't be read, uses the URL as is.
   */
  private async prepare(job: Job): Promise<string> {
    if (job.media?.source !== 'captured' || job.media.type !== 'hls') return job.url;
    try {
      const headers: Record<string, string> = {};
      for (const h of job.options.headers ?? []) {
        const i = h.indexOf(':');
        if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
      }
      const res = await fetch(job.url, { headers, signal: AbortSignal.timeout(15_000) });
      const text = res.ok ? await res.text() : '';
      if (!text.includes('#EXT-X-STREAM-INF') && !text.includes('#EXT-X-MEDIA')) return job.url;
      const dir = path.join(app.getPath('userData'), 'tmp');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `hls-${job.id}.m3u8`);
      fs.writeFileSync(file, safeHlsMaster(text, res.url || job.url));
      return pathToFileURL(file).href;
    } catch (e) {
      log.info(`video job ${job.id}: playlist copy failed, using the link directly: ${(e as Error).message}`);
      return job.url;
    }
  }

  private start(job: Job, url = job.url): void {
    let child: ChildProcess;
    try {
      child = spawnHelper(ytdlpPath(), ytdlpArgs(job, url), { stdio: ['ignore', 'pipe', 'pipe'], lowPriority: true });
    } catch (e) {
      this.hooks.failed(job, 'EXTRACTOR', 'yt-dlp couldn’t be started', String(e));
      return;
    }
    const run: Run = { child, stopped: false, lastError: '', stderrTail: [], doneBefore: 0, currentTotal: 0 };
    this.runs.set(job.id, run);
    job.doneBytes = 0;
    this.hooks.started(job);

    const onLine = (line: string) => {
      const l = parseYtLine(line);
      if (l.kind === 'progress') {
        const p = l.p;
        if (p.filename && p.filename !== run.currentFile) {
          if (run.currentFile) run.doneBefore += run.currentTotal;
          run.currentFile = p.filename;
        }
        const total = p.total_bytes || p.total_bytes_estimate || 0;
        if (total) run.currentTotal = total;
        job.doneBytes = run.doneBefore + (p.downloaded_bytes ?? 0);
        // The size the popup estimated covers both streams; prefer it until real totals add up.
        const known = run.doneBefore + run.currentTotal;
        if (known > (job.totalBytes ?? 0) || !job.totalBytes) job.totalBytes = known || job.totalBytes;
        job.speed = p.speed ?? 0;
        job.eta = p.eta ?? null;
        this.hooks.progress(job);
      } else if (l.kind === 'post') {
        const note = l.p.status === 'started' ? postNote(l.p.postprocessor) : undefined;
        if (note) this.hooks.postprocessing(job, note);
      } else if (l.kind === 'path') {
        run.filePath = l.path;
      } else if (l.kind === 'error') {
        run.lastError = l.message;
      }
    };
    readline.createInterface({ input: child.stdout! }).on('line', onLine);
    readline.createInterface({ input: child.stderr! }).on('line', (line) => {
      run.stderrTail.push(line);
      if (run.stderrTail.length > 20) run.stderrTail.shift();
      if (line.startsWith('ERROR:')) run.lastError = line.replace(/^ERROR:\s*/, '');
    });

    child.once('error', (e) => {
      run.lastError = run.lastError || e.message;
    });
    child.once('close', (code) => {
      if (this.runs.get(job.id) === run) this.runs.delete(job.id);
      if (url.startsWith('file:')) fs.rmSync(new URL(url), { force: true });
      if (run.stopped) return;
      if (code === 0) {
        this.hooks.finished(job, run.filePath);
      } else {
        const msg = run.lastError || `yt-dlp exited with code ${code}`;
        const detail = `yt-dlp ${path.basename(ytdlpPath())} exit ${code}: ${msg}\n${run.stderrTail.join('\n')}`;
        log.info(`video job ${job.id} failed: ${msg.slice(0, 300)}`);
        this.hooks.failed(job, mapYtdlpError(msg), msg, detail);
      }
      this.schedule();
    });
  }
}
