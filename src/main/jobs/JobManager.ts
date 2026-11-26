import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  tabOf,
  type AddJobRequest,
  type ErrorCode,
  type Job,
  type JobError,
  type JobStatus,
  type JobUpdate,
  type ProbeResult,
  type Settings,
  type Tab
} from '@shared/types';
import { canTransition } from '@shared/jobState';
import { AUTO_RETRY_CODES, RETRY_BACKOFF_MS, friendlyError, mapAria2Error } from '@shared/errors';
import { toAria2Limit } from '@shared/limits';
import type { Aria2Client, Aria2Event } from '../aria2/client';
import type { Db } from '../db';
import { globalAria2Options, type SettingsStore } from '../settings';
import { sanitizeFilename } from '../probeParse';
import { log } from '../log';

interface A2File {
  index: string;
  path: string;
  length: string;
  selected?: string;
}

interface A2Status {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength?: string;
  completedLength?: string;
  downloadSpeed?: string;
  uploadSpeed?: string;
  connections?: string;
  numSeeders?: string;
  followedBy?: string[];
  errorCode?: string;
  errorMessage?: string;
  files?: A2File[];
  bittorrent?: { info?: { name?: string } };
  seeder?: string;
}

const POLL_KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'numSeeders'];
const FULL_KEYS = [...POLL_KEYS, 'followedBy', 'errorCode', 'errorMessage', 'files', 'bittorrent', 'seeder'];

export interface Notifier {
  done(job: Job): void;
  failed(job: Job): void;
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string
  ) {
    super(message);
  }
  toJobError(): JobError {
    return { code: this.code, message: this.message };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRemote = (url: string) => /^(https?|s?ftp|magnet):/i.test(url);

/**
 * Owns every job and maps each to an aria2 GID. aria2 reports into it; the renderer
 * only ever sees Job objects (pushed as batched `update` events).
 */
export class JobManager extends EventEmitter {
  private jobs = new Map<string, Job>();
  private byGid = new Map<string, string>();
  private probes = new Map<string, string>(); // probeId → gid (paused torrent awaiting file choice)
  private client?: Aria2Client;
  private pollTimer?: NodeJS.Timeout;
  private polling = false;
  private flushTimer?: NodeJS.Timeout;
  private dirty = new Set<string>();
  private removedIds = new Set<string>();
  private persistTimer?: NodeJS.Timeout;
  private persistDirty = new Set<string>();
  private retryTimers = new Map<string, NodeJS.Timeout>();
  /** Local .torrent / .metalink paths the user picked through a native dialog. */
  readonly allowedLocal = new Set<string>();
  private firstAttach = true;

  constructor(
    private db: Db,
    private settings: SettingsStore,
    private notifier: Notifier,
    private logTail: () => string
  ) {
    super();
  }

  // ---------------------------------------------------------------- lifecycle

  load(): void {
    for (const job of this.db.loadJobs()) {
      if (job.status === 'probing') continue;
      if (job.status === 'active') job.status = 'queued'; // until reconciled with aria2
      job.speed = 0;
      job.uploadSpeed = 0;
      job.eta = null;
      this.jobs.set(job.id, job);
    }
    this.pruneHistory();
  }

  /** Called whenever the aria2 daemon (re)connects. */
  async attach(client: Aria2Client): Promise<void> {
    this.client = client;
    this.probes.clear();
    try {
      await this.reconcile(client);
    } catch (e) {
      log.error('reconcile failed', e);
    }
    this.firstAttach = false;
    this.ensurePolling();
  }

  detach(): void {
    this.client = undefined;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    for (const job of this.jobs.values()) {
      if (job.speed || job.uploadSpeed) {
        job.speed = 0;
        job.uploadSpeed = 0;
        job.eta = null;
        this.markDirty(job);
      }
    }
  }

  /** Before quit: keep secrets out of the session file, then let the daemon save it. */
  async shutdown(): Promise<void> {
    for (const t of this.retryTimers.values()) clearTimeout(t);
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.clearProbes();
    const client = this.client;
    if (client?.connected) {
      for (const job of this.jobs.values()) {
        if (job.gid && job.options.headers?.length && ['queued', 'active', 'paused'].includes(job.status)) {
          await client.call('aria2.forceRemove', job.gid).catch(() => {});
          await sleep(100);
          await client.call('aria2.removeDownloadResult', job.gid).catch(() => {});
          job.gid = undefined; // re-added from SQLite with continue=true on next launch
        }
      }
    }
    this.flushPersist(true);
  }

  // ---------------------------------------------------------------- queries

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  counts(): { active: number; queued: number } {
    let active = 0;
    let queued = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'active') active++;
      else if (j.status === 'queued') queued++;
    }
    return { active, queued };
  }

  // ---------------------------------------------------------------- probe (torrents)

  /**
   * Torrents are added to aria2 paused so the file list can be read with getFiles.
   * Magnets (and .torrent URLs) first fetch metadata; `pause-metadata` holds the
   * follow-up download until the user picks files.
   */
  async probeTorrent(url: string, dir: string): Promise<ProbeResult> {
    const client = this.requireClient();
    await this.clearProbes();
    const probeId = crypto.randomUUID();
    const opts = { dir, 'pause-metadata': 'true' };
    let gid: string;
    let peers: number | undefined;

    if (!isRemote(url)) {
      if (!this.allowedLocal.has(url)) throw new AppError('PROBE_FAILED', 'Choose the .torrent file with Open .torrent file…');
      const b64 = fs.readFileSync(url).toString('base64');
      gid = await client.call<string>('aria2.addTorrent', b64, [], { ...opts, pause: 'true' });
      this.probes.set(probeId, gid);
    } else {
      const metaGid = await client.call<string>('aria2.addUri', [url], opts);
      this.probes.set(probeId, metaGid);
      const deadline = Date.now() + 60_000;
      let followed: string | undefined;
      while (Date.now() < deadline) {
        await sleep(500);
        if (!this.probes.has(probeId)) throw new AppError('PROBE_FAILED', 'Cancelled');
        const s = await client.call<A2Status>('aria2.tellStatus', metaGid, ['status', 'followedBy', 'connections', 'errorCode', 'errorMessage']);
        peers = Number(s.connections) || peers;
        if (s.status === 'error') {
          await client.call('aria2.removeDownloadResult', metaGid).catch(() => {});
          this.probes.delete(probeId);
          throw new AppError(mapAria2Error(s.errorCode), s.errorMessage || 'Could not fetch the torrent');
        }
        if (s.status === 'complete' && s.followedBy?.length) {
          followed = s.followedBy[0];
          await client.call('aria2.removeDownloadResult', metaGid).catch(() => {});
          break;
        }
      }
      if (!followed) {
        await client.call('aria2.forceRemove', metaGid).catch(() => {});
        this.probes.delete(probeId);
        throw new AppError(
          'PROBE_FAILED',
          'No peers sent the file list within a minute. You can still add the magnet; it starts once metadata arrives.'
        );
      }
      gid = followed;
      this.probes.set(probeId, gid);
    }

    const files = await client.call<A2File[]>('aria2.getFiles', gid);
    const st = await client.call<A2Status>('aria2.tellStatus', gid, ['bittorrent', 'totalLength']);
    const name = sanitizeFilename(st.bittorrent?.info?.name || '') || 'Untitled torrent';
    const root = path.join(dir, name);
    return {
      kind: 'torrent',
      url,
      filename: name,
      size: Number(st.totalLength) || files.reduce((n, f) => n + Number(f.length), 0),
      resumable: true,
      peers,
      probeId,
      files: files.map((f) => {
        const rel = path.relative(root, f.path);
        return { index: Number(f.index), name: rel && !rel.startsWith('..') ? rel : path.basename(f.path), size: Number(f.length) };
      })
    };
  }

  async clearProbes(): Promise<void> {
    const gids = [...this.probes.values()];
    this.probes.clear();
    const client = this.client;
    if (!client?.connected) return;
    for (const gid of gids) {
      await client.call('aria2.forceRemove', gid).catch(() => {});
    }
    if (gids.length) await sleep(200);
    for (const gid of gids) await client.call('aria2.removeDownloadResult', gid).catch(() => {});
  }

  // ---------------------------------------------------------------- commands

  async add(req: AddJobRequest): Promise<Job> {
    const s = this.settings.get();
    const tab = tabOf(req.kind);
    const dir = path.resolve(req.dir || (tab === 'torrent' ? s.dirTorrent : s.dirNormal));
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      throw new AppError('DISK_ERROR', `Can't write to ${dir}. Pick another folder.`);
    }
    if (!isRemote(req.url) && !this.allowedLocal.has(req.url)) {
      throw new AppError('PROBE_FAILED', 'Links need to start with http://, https://, ftp://, sftp:// or magnet:');
    }

    const filename = req.filename ? sanitizeFilename(req.filename) : undefined;
    if (req.kind === 'file' && filename && !req.force) {
      const target = path.join(dir, filename);
      if (fs.existsSync(target) && !fs.existsSync(`${target}.aria2`)) {
        if (s.ifExists === 'skip') throw new AppError('FILE_EXISTS', `${filename} is already in this folder, so it was skipped.`);
        if (s.ifExists === 'ask') throw new AppError('FILE_EXISTS', `${filename} is already in this folder.`);
      }
    }

    const now = Date.now();
    const resumable = req.resumable ?? true;
    const defaultConns = tab === 'torrent' ? s.peersPerTorrent : resumable ? s.connectionsPerFile : 1;
    const options = { ...req.options };
    const job: Job = {
      id: crypto.randomUUID(),
      kind: req.kind,
      url: req.url,
      title: filename || (req.kind === 'torrent' ? 'Torrent' : 'download'),
      outName: req.kind === 'file' ? filename : undefined,
      status: 'queued',
      dir,
      files: [],
      totalBytes: req.size ?? null,
      doneBytes: 0,
      speed: 0,
      uploadSpeed: 0,
      eta: null,
      connections: options.connections ?? defaultConns,
      resumable,
      host: hostOf(req.url),
      options,
      createdAt: now,
      updatedAt: now
    };
    if (req.kind === 'torrent' && options.selectFiles?.length && req.probeId) {
      job.selectionNote = `${options.selectFiles.length} files selected`;
    }

    const probeGid = req.probeId ? this.probes.get(req.probeId) : undefined;
    this.jobs.set(job.id, job); // before aria2 knows the GID, so early events find the job
    try {
      await this.startNew(job, probeGid, req.probeId);
    } catch (e) {
      this.jobs.delete(job.id);
      if (job.gid) this.byGid.delete(job.gid);
      throw e;
    }
    this.markDirty(job, true);
    this.ensurePolling();
    return job;
  }

  private async startNew(job: Job, probeGid: string | undefined, probeId: string | undefined): Promise<void> {
    const options = job.options;
    const dir = job.dir;
    if (probeGid && probeId) {
      // The paused probe download becomes the job.
      this.probes.delete(probeId);
      const client = this.requireClient();
      const change: Record<string, string> = { dir, 'bt-max-peers': String(job.connections) };
      if (options.selectFiles?.length) change['select-file'] = options.selectFiles.join(',');
      await client.call('aria2.changeOption', probeGid, change).catch((e) => log.warn('changeOption on probe', e));
      await client.call('aria2.unpause', probeGid);
      job.gid = probeGid;
      this.byGid.set(probeGid, job.id);
    } else {
      await this.submit(job, {});
    }
  }

  async pause(id: string): Promise<Job> {
    const job = this.get(id);
    if (job.status !== 'active' && job.status !== 'queued') return job;
    if (job.gid && this.client?.connected) {
      await this.client.call('aria2.pause', job.gid).catch(() => this.client?.call('aria2.forcePause', job.gid!).catch(() => {}));
    }
    this.setStatus(job, 'paused');
    return job;
  }

  async resume(id: string): Promise<Job> {
    const job = this.get(id);
    if (job.status !== 'paused') return job;
    const client = this.requireClient();
    let ok = false;
    if (job.gid) ok = await client.call('aria2.unpause', job.gid).then(() => true, () => false);
    this.setStatus(job, 'queued');
    if (!ok) await this.submit(job, { continue: true });
    this.ensurePolling();
    return job;
  }

  async pauseAll(): Promise<void> {
    for (const j of this.list()) if (j.status === 'active' || j.status === 'queued') await this.pause(j.id);
  }

  async resumeAll(): Promise<void> {
    for (const j of this.list()) if (j.status === 'paused') await this.resume(j.id).catch(() => {});
  }

  async retry(id: string, auto = false): Promise<Job> {
    const job = this.get(id);
    if (job.status !== 'error') return job;
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
    const client = this.requireClient();
    if (job.gid) {
      this.byGid.delete(job.gid);
      await client.call('aria2.removeDownloadResult', job.gid).catch(() => {});
      job.gid = undefined;
    }
    if (!auto) job.retries = 0;
    job.error = undefined;
    this.setStatus(job, 'queued');
    await this.submit(job, { continue: job.resumable });
    this.ensurePolling();
    return job;
  }

  /** Cancels a job (or removes a finished one from the list). Partial files are deleted on request. */
  async cancel(id: string, deleteFiles: boolean): Promise<void> {
    const job = this.get(id);
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
    const client = this.client;
    if (job.gid && client?.connected) {
      await client.call('aria2.forceRemove', job.gid).catch(() => {});
      await sleep(250);
      await client.call('aria2.removeDownloadResult', job.gid).catch(() => {});
      this.byGid.delete(job.gid);
    }
    if (deleteFiles) {
      const paths = job.files.length ? job.files : job.outName ? [path.join(job.dir, job.outName)] : [];
      for (const p of paths) {
        const abs = path.resolve(p);
        if (!abs.startsWith(path.resolve(job.dir) + path.sep)) continue; // never outside the job's folder
        for (const f of [abs, `${abs}.aria2`]) fs.rmSync(f, { force: true });
      }
    }
    if (canTransition(job.status, 'cancelled')) job.status = 'cancelled';
    this.jobs.delete(id);
    this.db.deleteJob(id);
    this.removedIds.add(id);
    this.scheduleFlush();
  }

  async clearCompleted(tab: Tab): Promise<void> {
    for (const j of this.list()) if (j.status === 'completed' && tabOf(j.kind) === tab) await this.cancel(j.id, false);
  }

  async setConnections(id: string, n: number): Promise<Job> {
    const job = this.get(id);
    const torrent = job.kind === 'torrent';
    const value = torrent ? Math.max(5, Math.min(200, n)) : Math.max(1, Math.min(job.resumable ? 16 : 1, n));
    job.connections = value;
    job.options = { ...job.options, connections: value };
    if (job.gid && this.client?.connected && job.status !== 'completed') {
      const opts = torrent ? { 'bt-max-peers': String(value) } : { split: String(value), 'max-connection-per-server': String(value) };
      await this.client.call('aria2.changeOption', job.gid, opts).catch((e) => log.warn('changeOption', e));
    }
    this.markDirty(job, true);
    return job;
  }

  /** Applies changed settings to aria2 live (no restart needed). */
  async applySettings(prev: Settings, next: Settings): Promise<void> {
    const a = globalAria2Options(prev);
    const b = { ...globalAria2Options(next), dir: next.dirNormal };
    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(b)) if ((a as Record<string, string>)[k] !== v || k === 'dir') changed[k] = v;
    if (prev.dirNormal === next.dirNormal) delete changed.dir;
    if (Object.keys(changed).length && this.client?.connected) {
      await this.client.call('aria2.changeGlobalOption', changed).catch((e) => log.warn('changeGlobalOption', e));
    }
    if (prev.historyKeep !== next.historyKeep) this.pruneHistory();
  }

  // ---------------------------------------------------------------- aria2 events

  async onEvent(e: Aria2Event): Promise<void> {
    const client = this.client;
    const job = this.jobByGid(e.gid);
    if (!job || !client) return;
    try {
      switch (e.type) {
        case 'aria2.onDownloadStart': {
          const s = await client.call<A2Status>('aria2.tellStatus', e.gid, FULL_KEYS);
          this.applyStatus(job, s);
          this.ensurePolling();
          break;
        }
        case 'aria2.onDownloadPause':
          if (job.status === 'active' || job.status === 'queued') this.setStatus(job, 'paused');
          break;
        case 'aria2.onBtDownloadComplete':
          this.complete(job);
          break;
        case 'aria2.onDownloadComplete': {
          const s = await client.call<A2Status>('aria2.tellStatus', e.gid, FULL_KEYS);
          if (s.followedBy?.length) {
            // Metadata (magnet / .torrent URL / metalink) finished: follow the real download.
            const next = s.followedBy[0];
            this.byGid.delete(e.gid);
            this.byGid.set(next, job.id);
            job.gid = next;
            await client.call('aria2.removeDownloadResult', e.gid).catch(() => {});
            const ns = await client.call<A2Status>('aria2.tellStatus', next, FULL_KEYS);
            if (ns.status === 'paused' && job.status !== 'paused') await client.call('aria2.unpause', next).catch(() => {});
            this.applyStatus(job, ns);
            this.markDirty(job, true);
          } else {
            this.applyStatus(job, s);
            this.complete(job);
            job.uploadSpeed = 0;
            this.byGid.delete(e.gid);
            await client.call('aria2.removeDownloadResult', e.gid).catch(() => {});
          }
          break;
        }
        case 'aria2.onDownloadError': {
          const s = await client.call<A2Status>('aria2.tellStatus', e.gid, FULL_KEYS);
          this.fail(job, s);
          break;
        }
        case 'aria2.onDownloadStop':
          break; // removals are initiated by the app; cancel() already handled it
      }
    } catch (err) {
      log.warn('event handling failed', e.type, err);
    }
  }

  // ---------------------------------------------------------------- internals

  private async reconcile(client: Aria2Client): Promise<void> {
    const [active, waiting, stopped] = (await client.multicall([
      ['aria2.tellActive', FULL_KEYS],
      ['aria2.tellWaiting', 0, 10_000, FULL_KEYS],
      ['aria2.tellStopped', 0, 10_000, FULL_KEYS]
    ])) as A2Status[][];
    const all = [...(active || []), ...(waiting || []), ...(stopped || [])];
    const known = new Map(all.map((s) => [s.gid, s]));
    const resume = this.settings.get().resumeOnLaunch;
    const holdAll = this.firstAttach && !resume;
    this.byGid.clear();
    const claimed = new Set<string>();

    for (const job of this.list()) {
      const live = job.status === 'queued' || job.status === 'active' || job.status === 'paused';
      const s = job.gid ? known.get(job.gid) : undefined;
      if (!live) {
        // A finished torrent may still be seeding in this aria2 instance.
        if (job.status === 'completed' && s && s.status === 'active') {
          claimed.add(s.gid);
          this.byGid.set(s.gid, job.id);
        }
        continue;
      }
      if (holdAll && job.status !== 'paused') this.setStatus(job, 'paused');
      if (s && (s.status === 'active' || s.status === 'waiting' || s.status === 'paused')) {
        claimed.add(s.gid);
        this.byGid.set(s.gid, job.id);
        if (job.status === 'paused' && s.status !== 'paused') await client.call('aria2.pause', s.gid).catch(() => {});
        if (job.status !== 'paused' && s.status === 'paused') await client.call('aria2.unpause', s.gid).catch(() => {});
        this.applyStatus(job, s);
      } else if (s && s.status === 'complete' && !s.followedBy?.length) {
        claimed.add(s.gid);
        this.byGid.set(s.gid, job.id);
        this.applyStatus(job, s);
        this.complete(job);
      } else {
        // GID is gone (e.g. secrets kept out of the session): re-add and resume from the .aria2 file.
        job.gid = undefined;
        try {
          await this.submit(job, { continue: true, pause: job.status === 'paused' });
        } catch (e) {
          this.setError(job, { code: 'UNKNOWN', message: (e as Error).message });
        }
      }
    }
    // Downloads aria2 restored that no job owns.
    for (const s of all) {
      if (claimed.has(s.gid) || this.byGid.has(s.gid)) continue;
      if (s.status === 'active' || s.status === 'waiting' || s.status === 'paused') {
        await client.call('aria2.forceRemove', s.gid).catch(() => {});
      }
      await client.call('aria2.removeDownloadResult', s.gid).catch(() => {});
    }
  }

  /** Adds a job to aria2 (new or re-added). */
  private async submit(job: Job, flags: { continue?: boolean; pause?: boolean }): Promise<void> {
    const client = this.requireClient();
    const s = this.settings.get();
    const o: Record<string, string | string[]> = { dir: job.dir };
    if (job.kind === 'file' && job.outName) o.out = job.outName;
    if (job.kind === 'torrent') o['bt-max-peers'] = String(job.connections);
    else {
      const n = job.resumable ? job.connections : 1;
      o.split = String(n);
      o['max-connection-per-server'] = String(n);
    }
    if (job.options.speedLimitKBps && job.options.speedLimitKBps > 0) o['max-download-limit'] = toAria2Limit(job.options.speedLimitKBps);
    if (job.options.headers?.length) o.header = job.options.headers;
    if (job.options.selectFiles?.length) o['select-file'] = job.options.selectFiles.join(',');
    if (job.options.overwrite === true) {
      o['allow-overwrite'] = 'true';
      o['auto-file-renaming'] = 'false';
    } else if (job.options.overwrite === false || s.ifExists !== 'overwrite') {
      o['allow-overwrite'] = 'false';
      o['auto-file-renaming'] = 'true';
    }
    if (flags.continue) o.continue = 'true';
    if (flags.pause) o.pause = 'true';

    let gid: string;
    const remote = isRemote(job.url);
    if (!remote && job.kind === 'torrent') {
      const b64 = fs.readFileSync(job.url).toString('base64');
      gid = await client.call<string>('aria2.addTorrent', b64, [], o);
    } else if (!remote && job.kind === 'metalink') {
      const b64 = fs.readFileSync(job.url).toString('base64');
      const gids = await client.call<string[]>('aria2.addMetalink', b64, o);
      gid = gids[0];
    } else {
      gid = await client.call<string>('aria2.addUri', [job.url], o);
    }
    job.gid = gid;
    this.byGid.set(gid, job.id);
    this.setStatus(job, flags.pause ? 'paused' : 'queued');
  }

  private applyStatus(job: Job, s: A2Status): void {
    const total = Number(s.totalLength) || 0;
    const done = Number(s.completedLength) || 0;
    if (total > 0) job.totalBytes = total;
    job.doneBytes = done;
    job.speed = Number(s.downloadSpeed) || 0;
    job.uploadSpeed = Number(s.uploadSpeed) || 0;
    job.eta = job.speed > 0 && total > 0 ? (total - done) / job.speed : null;
    if (job.kind === 'torrent') {
      job.peers = Number(s.connections) || 0;
      if (s.numSeeders != null) job.seeders = Number(s.numSeeders) || 0;
    }
    if (s.files?.length) {
      const files = s.files.filter((f) => f.selected !== 'false' && f.path && !f.path.startsWith('[METADATA]')).map((f) => path.normalize(f.path)); // aria2 reports C:/... on Windows
      if (files.length) job.files = files;
    }
    if (s.bittorrent?.info?.name) job.title = s.bittorrent.info.name;
    else if (job.kind !== 'torrent' && job.files[0]) {
      job.title = path.basename(job.files[0]);
      if (job.kind === 'file') job.outName = job.title;
    }
    if (job.status !== 'completed') {
      const next: JobStatus | undefined =
        s.status === 'active' ? 'active' : s.status === 'waiting' ? 'queued' : s.status === 'paused' ? 'paused' : undefined;
      if (next) this.setStatus(job, next);
    }
    this.markDirty(job);
  }

  private complete(job: Job): void {
    if (job.status === 'completed') return;
    if (job.totalBytes) job.doneBytes = job.totalBytes;
    job.speed = 0;
    job.eta = null;
    job.error = undefined;
    job.completedAt = Date.now();
    this.setStatus(job, 'completed');
    if (this.settings.get().notifyDone) this.notifier.done(job);
  }

  private fail(job: Job, s: A2Status): void {
    const code = mapAria2Error(s.errorCode);
    const raw = s.errorMessage || '';
    const gid = job.gid ?? '';
    const tail = this.logTail()
      .split('\n')
      .filter((l) => gid && l.includes(gid))
      .slice(-10)
      .join('\n');
    const error: JobError = {
      code,
      message: friendlyError(code, raw),
      detail: `aria2 errorCode ${s.errorCode ?? '?'}: ${raw}${tail ? `\n${tail}` : ''}`
    };
    const retries = job.retries ?? 0;
    // 429 Too Many Requests / 503 Service Unavailable are temporary: back off and retry like network errors.
    const throttled = code === 'HTTP_ERROR' && /status=(429|503)\b/.test(raw);
    if ((AUTO_RETRY_CODES.has(code) || throttled) && retries < RETRY_BACKOFF_MS.length) {
      job.retries = retries + 1;
      const wait = RETRY_BACKOFF_MS[retries];
      this.setError(job, { ...error, message: `${throttled ? 'Server busy' : 'Network error'} · retrying in ${wait >= 60_000 ? `${wait / 60_000} min` : `${wait / 1000} s`}` }, false);
      this.retryTimers.set(
        job.id,
        setTimeout(() => {
          this.retryTimers.delete(job.id);
          void this.retry(job.id, true).catch((e) => log.warn('auto retry failed', e));
        }, wait)
      );
      return;
    }
    this.setError(job, error);
  }

  private setError(job: Job, error: JobError, notify = true): void {
    job.error = error;
    job.speed = 0;
    job.eta = null;
    this.setStatus(job, 'error');
    if (notify && this.settings.get().notifyFail) this.notifier.failed(job);
  }

  private setStatus(job: Job, to: JobStatus): void {
    const from = job.status;
    if (from === to) return;
    if (!canTransition(from, to)) {
      // aria2 can move paused → active between polls; route it through queued as the state machine requires.
      if ((from === 'paused' || from === 'error') && to === 'active') {
        job.status = 'queued';
      } else {
        log.warn(`ignored illegal transition ${from} → ${to} for ${job.id}`);
        return;
      }
    }
    job.status = to;
    if (to !== 'error') job.error = undefined;
    if (to !== 'active') {
      job.speed = 0;
      job.eta = null;
    }
    this.markDirty(job, true);
  }

  private pruneHistory(): void {
    const keep = this.settings.get().historyKeep;
    if (keep === 'forever') return;
    const cutoff = Date.now() - Number(keep) * 86_400_000;
    for (const j of this.list()) {
      if (j.status === 'completed' && (j.completedAt ?? j.updatedAt) < cutoff) {
        this.jobs.delete(j.id);
        this.db.deleteJob(j.id);
        this.removedIds.add(j.id);
      }
    }
    this.scheduleFlush();
  }

  private ensurePolling(): void {
    if (this.pollTimer || !this.client) return;
    this.pollTimer = setInterval(() => void this.poll(), 500);
  }

  /** Progress isn't pushed by aria2: poll active + waiting in one multicall while anything runs. */
  private async poll(): Promise<void> {
    const client = this.client;
    const live = [...this.jobs.values()].some(
      (j) => j.status === 'active' || j.status === 'queued' || (j.status === 'completed' && j.uploadSpeed > 0)
    );
    if (!live || !client?.connected) {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      return;
    }
    if (this.polling) return;
    this.polling = true;
    try {
      const [act, wait] = (await client.multicall([
        ['aria2.tellActive', POLL_KEYS],
        ['aria2.tellWaiting', 0, 1000, POLL_KEYS]
      ])) as A2Status[][];
      for (const s of [...(act || []), ...(wait || [])]) {
        const job = this.jobByGid(s.gid);
        if (job) this.applyStatus(job, s);
      }
    } catch {
      /* engine restarting */
    } finally {
      this.polling = false;
    }
  }

  private markDirty(job: Job, statusChange = false): void {
    job.updatedAt = Date.now();
    this.dirty.add(job.id);
    this.scheduleFlush();
    if (statusChange) {
      this.db.saveJob(job); // status changes are written immediately
      this.persistDirty.delete(job.id);
    } else {
      this.persistDirty.add(job.id);
      if (!this.persistTimer) this.persistTimer = setTimeout(() => this.flushPersist(), 1000);
    }
  }

  private flushPersist(final = false): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const list = [...this.persistDirty].map((id) => this.jobs.get(id)).filter((j): j is Job => !!j);
    this.persistDirty.clear();
    if (final) list.push(...this.jobs.values());
    if (list.length) this.db.saveJobs(list);
  }

  /** Batches renderer updates every 250 ms. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      const updates: JobUpdate[] = [];
      for (const id of this.dirty) {
        const job = this.jobs.get(id);
        if (job) updates.push({ id, job: { ...job, options: { ...job.options, headers: undefined } } });
      }
      for (const id of this.removedIds) updates.push({ id, removed: true });
      this.dirty.clear();
      this.removedIds.clear();
      if (updates.length) this.emit('update', updates);
    }, 250);
  }

  private jobByGid(gid: string): Job | undefined {
    const id = this.byGid.get(gid);
    return id ? this.jobs.get(id) : undefined;
  }

  private get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('UNKNOWN', 'That download no longer exists.');
    return job;
  }

  private requireClient(): Aria2Client {
    if (!this.client?.connected) throw new AppError('ENGINE_CRASH', 'The download engine is not running.');
    return this.client;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}
