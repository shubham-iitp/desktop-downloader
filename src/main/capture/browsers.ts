import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, CustomBrowser } from '@shared/types';
import { killTree, spawnHelper } from '../proc';

interface Known {
  id: string;
  name: string;
  /** Windows: App Paths key name (unique ones only: Chromium's chrome.exe collides with Chrome). */
  appPath?: string;
  /** Windows: path under Program Files / Program Files (x86) / %LOCALAPPDATA%. */
  win: string;
  mac: string;
  linux: string[];
}

const KNOWN: Known[] = [
  { id: 'chrome', name: 'Google Chrome', appPath: 'chrome.exe', win: 'Google\\Chrome\\Application\\chrome.exe', mac: 'Google Chrome', linux: ['google-chrome', 'google-chrome-stable'] },
  { id: 'edge', name: 'Microsoft Edge', appPath: 'msedge.exe', win: 'Microsoft\\Edge\\Application\\msedge.exe', mac: 'Microsoft Edge', linux: ['microsoft-edge', 'microsoft-edge-stable'] },
  { id: 'brave', name: 'Brave', appPath: 'brave.exe', win: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', mac: 'Brave Browser', linux: ['brave-browser'] },
  { id: 'chromium', name: 'Chromium', win: 'Chromium\\Application\\chrome.exe', mac: 'Chromium', linux: ['chromium', 'chromium-browser'] },
  { id: 'vivaldi', name: 'Vivaldi', appPath: 'vivaldi.exe', win: 'Vivaldi\\Application\\vivaldi.exe', mac: 'Vivaldi', linux: ['vivaldi', 'vivaldi-stable'] }
];

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

function regDefault(key: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/ve'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(undefined);
      const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
      resolve(m ? m[1].trim().replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? '') : undefined);
    });
  });
}

async function findWindows(k: Known): Promise<string | undefined> {
  if (k.appPath) {
    for (const hive of ['HKCU', 'HKLM']) {
      const p = await regDefault(`${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${k.appPath}`);
      if (p && isFile(p)) return p;
    }
  }
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  return roots.map((r) => path.join(r, k.win)).find(isFile);
}

function findMac(k: Known): string | undefined {
  const rel = path.join(`${k.mac}.app`, 'Contents', 'MacOS', k.mac);
  return ['/Applications', path.join(os.homedir(), 'Applications')].map((r) => path.join(r, rel)).find(isFile);
}

function findLinux(k: Known): string | undefined {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const name of k.linux) {
    const hit = dirs.map((d) => path.join(d, name)).find(isFile);
    if (hit) return hit;
  }
  return undefined;
}

/** Chromium browsers in their usual install locations (tech doc table), then the user's verified ones. */
export async function detectBrowsers(custom: CustomBrowser[]): Promise<Browser[]> {
  const out: Browser[] = [];
  for (const k of KNOWN) {
    const p = process.platform === 'win32' ? await findWindows(k) : process.platform === 'darwin' ? findMac(k) : findLinux(k);
    if (p && !out.some((b) => path.resolve(b.path) === path.resolve(p))) out.push({ id: k.id, name: k.name, path: p, custom: false });
  }
  for (const c of custom) if (isFile(c.path)) out.push({ ...c, custom: true });
  return out;
}

/** Reads the port a browser started with --remote-debugging-port=0 wrote to its profile. */
export async function waitDevToolsPort(profile: string, timeoutMs: number, alive: () => boolean): Promise<number | undefined> {
  const file = path.join(profile, 'DevToolsActivePort');
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && alive()) {
    try {
      const port = Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
      if (port > 0 && port < 65536) return port;
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

/** A friendly name for a browser the user picked: "Chromium (portable)" style, from its folder. */
function nameFor(exe: string): string {
  const base = path.basename(exe).replace(/\.(exe|app)$/i, '');
  const known: Record<string, string> = { chrome: 'Chrome', msedge: 'Microsoft Edge', brave: 'Brave', vivaldi: 'Vivaldi', chromium: 'Chromium', opera: 'Opera' };
  const n = known[base.toLowerCase()] ?? base.charAt(0).toUpperCase() + base.slice(1);
  const parent = path.basename(path.dirname(path.dirname(exe))) || path.basename(path.dirname(exe));
  return /portable/i.test(exe) ? `${n} (portable)` : parent && !/application|program files|bin/i.test(parent) ? `${n} (${parent})` : n;
}

/**
 * Checks a browser picked with Browse…: launch it headless with remote debugging and a throwaway
 * profile, and wait up to 10 s for DevToolsActivePort. Only Chromium browsers write that file.
 */
export async function verifyBrowser(exe: string): Promise<CustomBrowser | undefined> {
  if (!isFile(exe)) return undefined;
  if (process.platform === 'win32' && !/\.exe$/i.test(exe)) return undefined;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-browser-check-'));
  const child = spawnHelper(
    exe,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'],
    { stdio: 'ignore' }
  );
  let exited = false;
  child.once('exit', () => (exited = true));
  child.once('error', () => (exited = true));
  try {
    const port = await waitDevToolsPort(profile, 10_000, () => !exited);
    return port ? { id: `custom-${crypto.randomUUID().slice(0, 8)}`, name: nameFor(exe), path: exe } : undefined;
  } finally {
    await killTree(child);
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500);
  }
}
