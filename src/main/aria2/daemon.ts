import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { EngineStatus, Settings } from '@shared/types';
import { Aria2Client, type Aria2Event } from './client';
import { globalAria2Options } from '../settings';
import { log } from '../log';

export interface DaemonPaths {
  bin: string;
  userData: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Picks a free localhost port: 6800 if it's free, else one from the OS. */
export async function pickPort(preferred = 6800): Promise<number> {
  const tryListen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        const addr = srv.address();
        const p = typeof addr === 'object' && addr ? addr.port : port;
        srv.close(() => resolve(p));
      });
    });
  try {
    return await tryListen(preferred);
  } catch {
    return tryListen(0);
  }
}

/**
 * Owns the long-lived aria2c process. Restarts it once after an unexpected exit;
 * a second crash leaves the engine in the `crashed` state for the Repair screen.
 *
 * Events: 'status' (EngineStatus), 'ready' (Aria2Client), 'event' (Aria2Event).
 */
export class Aria2Daemon extends EventEmitter {
  private proc?: ChildProcess;
  client?: Aria2Client;
  private stopping = false;
  private crashes = 0;
  private lastStderr = '';
  status: EngineStatus;

  readonly sessionFile: string;
  readonly logFile: string;

  constructor(
    private paths: DaemonPaths,
    private getSettings: () => Settings
  ) {
    super();
    this.sessionFile = path.join(paths.userData, 'aria2.session');
    this.logFile = path.join(paths.userData, 'logs', 'aria2.log');
    this.status = { state: 'starting', binPath: paths.bin };
  }

  private setStatus(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  async start(): Promise<void> {
    this.stopping = false;
    if (!fs.existsSync(this.paths.bin)) {
      this.setStatus({ state: 'missing', error: 'File not found' });
      return;
    }
    this.setStatus({ state: this.crashes ? 'restarting' : 'starting', error: undefined });

    fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    if (!fs.existsSync(this.sessionFile)) fs.writeFileSync(this.sessionFile, '', { mode: 0o600 });
    try {
      fs.chmodSync(this.sessionFile, 0o600); // the session can hold per-job options
    } catch {
      /* not supported on every filesystem */
    }

    const port = await pickPort();
    const secret = crypto.randomBytes(32).toString('hex');
    const s = this.getSettings();
    const opts = globalAria2Options(s);
    const args = [
      '--enable-rpc=true',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${port}`,
      `--rpc-secret=${secret}`,
      '--rpc-max-request-size=16M',
      `--dir=${s.dirNormal}`,
      `--input-file=${this.sessionFile}`,
      `--save-session=${this.sessionFile}`,
      '--save-session-interval=30',
      '--force-save=false',
      // --continue is set per job when the app re-adds its own unfinished downloads; a global
      // --continue=true would "resume" into unrelated existing files and defeat "Keep both".
      '--bt-save-metadata=true',
      '--follow-torrent=true',
      '--check-certificate=true',
      '--console-log-level=warn',
      `--log=${this.logFile}`,
      '--log-level=notice',
      `--stop-with-process=${process.pid}`,
      '--min-split-size=1M',
      ...Object.entries(opts).map(([k, v]) => `--${k}=${v}`)
    ];

    log.info(`starting aria2c on 127.0.0.1:${port}`);
    let proc: ChildProcess;
    try {
      proc = spawn(this.paths.bin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      this.setStatus({ state: 'missing', error: (e as Error).message });
      return;
    }
    this.proc = proc;
    this.lastStderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      this.lastStderr = (this.lastStderr + d.toString()).slice(-4000);
    });

    const spawnError = await new Promise<Error | null>((resolve) => {
      proc.once('error', (e) => resolve(e));
      proc.once('spawn', () => resolve(null));
    });
    if (spawnError) {
      const code = (spawnError as NodeJS.ErrnoException).code;
      this.setStatus({
        state: 'missing',
        error: code === 'ENOENT' ? 'File not found' : code === 'EACCES' || code === 'EPERM' ? 'Blocked from running' : spawnError.message
      });
      return;
    }

    proc.once('exit', (code, signal) => this.onExit(proc, code, signal));

    const client = new Aria2Client(port, secret, (e: Aria2Event) => this.emit('event', e));
    let connected = false;
    for (let i = 0; i < 10 && !connected; i++) {
      await sleep(200);
      if (proc.exitCode !== null) break;
      try {
        await client.connect();
        connected = true;
      } catch {
        /* retry */
      }
    }
    if (!connected) {
      log.error('could not connect to aria2c RPC', this.lastStderr);
      proc.kill();
      return; // onExit decides whether to retry
    }

    this.client = client;
    let version: string | undefined;
    try {
      version = (await client.call<{ version: string }>('aria2.getVersion')).version;
    } catch {
      /* not fatal */
    }
    this.setStatus({ state: 'running', version, startedAt: Date.now(), error: undefined });
    this.emit('ready', client);
  }

  private onExit(proc: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
    if (proc !== this.proc) return;
    this.client?.close();
    this.client = undefined;
    this.proc = undefined;
    if (this.stopping) return;
    this.crashes++;
    log.error(`aria2c exited (code ${code}, signal ${signal})`, this.lastStderr);
    if (this.crashes <= 1) {
      this.setStatus({ state: 'restarting' });
      void this.start();
    } else {
      this.setStatus({
        state: 'crashed',
        error: 'Engine exited unexpectedly (restarted once, exited again)'
      });
    }
  }

  /** User-initiated restart (Settings › Restart engine, Repair screen). Resets the crash count. */
  async restart(): Promise<void> {
    this.setStatus({ state: 'restarting' });
    await this.stop();
    this.crashes = 0;
    await this.start();
  }

  /** saveSession + shutdown, with a 3 s kill fallback. */
  async stop(): Promise<void> {
    this.stopping = true;
    const proc = this.proc;
    if (!proc) return;
    const exited = new Promise<void>((r) => proc.once('exit', () => r()));
    try {
      await this.client?.call('aria2.saveSession');
      await this.client?.call('aria2.shutdown');
    } catch {
      proc.kill();
    }
    const timer = setTimeout(() => proc.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
    this.client?.close();
    this.client = undefined;
  }

  readLogTail(lines = 20): string {
    try {
      const text = fs.readFileSync(this.logFile, 'utf8');
      return text.split(/\r?\n/).slice(-lines).join('\n');
    } catch {
      return '';
    }
  }
}
