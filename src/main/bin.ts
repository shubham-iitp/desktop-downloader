import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

/** Folder name under resources/bin, e.g. win32-x64, darwin-arm64, linux-x64. */
export const platformDir = `${process.platform}-${process.arch}`;

/** Where the bundled engines live (outside the asar: an asar can't be executed from). */
export const binDir = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', platformDir)
  : path.join(__dirname, '../../resources/bin', platformDir);

const exe = (name: string) => path.join(binDir, process.platform === 'win32' ? `${name}.exe` : name);

const bundled = exe('aria2c');

/**
 * Path of the aria2c binary. Packaged builds only ever use the bundled copy.
 * Development builds may point ARIA2C_PATH at a local aria2c (useful on macOS/Linux,
 * where there is no official prebuilt binary to fetch).
 */
export function aria2cPath(): string {
  if (!app.isPackaged && process.env.ARIA2C_PATH && !fs.existsSync(bundled)) {
    return process.env.ARIA2C_PATH;
  }
  return bundled;
}

/** yt-dlp keeps itself current in userData/bin (verified download); the bundled copy is the fallback. */
export const ytdlpUpdateDir = () => path.join(app.getPath('userData'), 'bin');
export const ytdlpName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
export const bundledYtdlp = () => exe('yt-dlp');
export const updatedYtdlp = () => path.join(ytdlpUpdateDir(), ytdlpName);

export function ytdlpPath(): string {
  const u = updatedYtdlp();
  return fs.existsSync(u) ? u : bundledYtdlp();
}

export const ffmpegPath = () => exe('ffmpeg');
export const denoPath = () => exe('deno');
export const ffprobePath = () => exe('ffprobe');
