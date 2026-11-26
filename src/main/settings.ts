import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { FONTS, type Settings } from '@shared/types';
import { toAria2Limit } from '@shared/limits';
import type { Db } from './db';

const speedLimit = z.number().int().min(-1).max(100_000);

export const settingsSchema = z.object({
  startOnLogin: z.boolean(),
  notifyDone: z.boolean(),
  notifyFail: z.boolean(),
  resumeOnLaunch: z.boolean(),
  dirNormal: z.string().min(1).max(4096),
  dirTorrent: z.string().min(1).max(4096),
  connectionsPerFile: z.number().int().min(1).max(16),
  peersPerTorrent: z.number().int().min(5).max(200),
  ifExists: z.enum(['rename', 'overwrite', 'skip', 'ask']),
  prealloc: z.boolean(),
  maxConcurrent: z.number().int().min(1).max(10),
  downloadLimit: speedLimit,
  uploadLimit: speedLimit,
  seedMode: z.enum(['0', '30', '120', 'ratio']),
  historyKeep: z.enum(['7', '30', '90', 'forever']),
  theme: z.enum(['dark', 'light', 'system']),
  font: z.enum(FONTS),
  density: z.enum(['comfortable', 'compact'])
});

export const settingsPatchSchema = settingsSchema.partial().strict();

export function defaultSettings(): Settings {
  const downloads = app.getPath('downloads');
  return {
    startOnLogin: false,
    notifyDone: true,
    notifyFail: true,
    resumeOnLaunch: true,
    dirNormal: downloads,
    dirTorrent: path.join(downloads, 'Torrents'),
    connectionsPerFile: 8,
    peersPerTorrent: 55,
    ifExists: 'rename',
    prealloc: true,
    maxConcurrent: 5,
    downloadLimit: -1,
    // A low upload cap keeps torrents fast without sharing much (the slider's lowest MB step).
    uploadLimit: 1000,
    seedMode: '0',
    historyKeep: '90',
    theme: 'system',
    font: 'Montserrat',
    density: 'comfortable'
  };
}

export class SettingsStore {
  private value: Settings;

  constructor(private db: Db) {
    const stored = db.getSetting<Partial<Settings>>('settings') ?? {};
    const merged = { ...defaultSettings(), ...stored };
    const parsed = settingsSchema.safeParse(merged);
    this.value = parsed.success ? parsed.data : defaultSettings();
  }

  get(): Settings {
    return { ...this.value };
  }

  update(patch: Partial<Settings>): Settings {
    const next = settingsSchema.parse({ ...this.value, ...patch });
    this.value = next;
    this.db.setSetting('settings', next);
    return this.get();
  }

  getFlag(key: string): boolean {
    return this.db.getSetting<boolean>(`flag:${key}`) ?? false;
  }

  setFlag(key: string, v: boolean): void {
    this.db.setSetting(`flag:${key}`, v);
  }
}

/** Seeding behaviour as aria2 options. seed-ratio 0.0 means "ignore ratio". */
export function seedOptions(mode: Settings['seedMode']): Record<string, string> {
  if (mode === 'ratio') return { 'seed-ratio': '1.0', 'seed-time': '525600' };
  return { 'seed-ratio': '0.0', 'seed-time': mode };
}

export function fileAllocation(prealloc: boolean): string {
  if (!prealloc) return 'none';
  // falloc is fast on NTFS/ext4; macOS has no posix_fallocate, so skip reservation there.
  return process.platform === 'darwin' ? 'none' : 'falloc';
}

export function existsOptions(policy: Settings['ifExists']): Record<string, string> {
  return policy === 'overwrite'
    ? { 'allow-overwrite': 'true', 'auto-file-renaming': 'false' }
    : { 'allow-overwrite': 'false', 'auto-file-renaming': 'true' };
}

/** Global aria2 options derived from settings (applied at launch and live on change). */
export function globalAria2Options(s: Settings): Record<string, string> {
  return {
    'max-concurrent-downloads': String(s.maxConcurrent),
    'max-overall-download-limit': toAria2Limit(s.downloadLimit),
    'max-overall-upload-limit': toAria2Limit(s.uploadLimit),
    split: String(s.connectionsPerFile),
    'max-connection-per-server': String(s.connectionsPerFile),
    'bt-max-peers': String(s.peersPerTorrent),
    'file-allocation': fileAllocation(s.prealloc),
    ...seedOptions(s.seedMode),
    ...existsOptions(s.ifExists)
  };
}
