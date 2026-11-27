import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import os from 'node:os';
import { log } from './log';

/**
 * Spawns a helper (yt-dlp, a browser check) without a shell. yt-dlp and the ffmpeg it starts
 * run below normal priority so merges and scans don't make the computer sluggish.
 */
export function spawnHelper(cmd: string, args: string[], opts: SpawnOptions & { lowPriority?: boolean } = {}): ChildProcess {
  const { lowPriority, ...rest } = opts;
  const child = spawn(cmd, args, {
    shell: false,
    windowsHide: true,
    // Its own process group on POSIX, so the whole tree (yt-dlp → ffmpeg) can be signalled.
    detached: process.platform !== 'win32',
    ...rest
  });
  if (lowPriority && child.pid) {
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      /* not allowed on this system */
    }
  }
  return child;
}

/** Kills a process and everything it started (yt-dlp leaves ffmpeg running otherwise). */
export function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null || !child.pid) return resolve();
    const done = () => resolve();
    child.once('exit', done);
    setTimeout(done, 5000);
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, (err) => {
        if (err) {
          try {
            child.kill();
          } catch (e) {
            log.warn('kill failed', e);
          }
        }
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  });
}

/** Runs a helper to completion and collects stdout (for `yt-dlp -J`, `--version`). */
export function runHelper(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; maxBytes?: number; lowPriority?: boolean } = {}
): { promise: Promise<{ code: number | null; stdout: string; stderr: string }>; child: ChildProcess } {
  const child = spawnHelper(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], lowPriority: opts.lowPriority });
  const max = opts.maxBytes ?? 64 * 1024 * 1024;
  const promise = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    child.stdout?.on('data', (b: Buffer) => {
      size += b.length;
      if (size > max) void killTree(child);
      else out.push(b);
    });
    child.stderr?.on('data', (b: Buffer) => {
      if (err.length < 2000) err.push(b);
    });
    const timer = opts.timeoutMs ? setTimeout(() => void killTree(child), opts.timeoutMs) : undefined;
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
  return { promise, child };
}
