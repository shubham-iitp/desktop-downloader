import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

/** Folder name under resources/bin, e.g. win32-x64, darwin-arm64, linux-x64. */
export const platformDir = `${process.platform}-${process.arch}`;

const root = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', platformDir)
  : path.join(__dirname, '../../resources/bin', platformDir);

const bundled = path.join(root, process.platform === 'win32' ? 'aria2c.exe' : 'aria2c');

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
