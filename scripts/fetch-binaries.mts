/*
 * Downloads and verifies the pinned aria2c for the current (or given) platform into
 * resources/bin/<platform>-<arch>/. Runs in CI before packaging.
 *
 *   node scripts/fetch-binaries.mts                 # current platform
 *   node scripts/fetch-binaries.mts win32-x64       # a specific target
 *   node scripts/fetch-binaries.mts --update-lock   # record hashes of what was downloaded
 *
 * Downloads only when the binary on disk doesn't match the pinned SHA-256.
 * aria2 publishes an official prebuilt for Windows only; macOS/Linux binaries are built
 * statically in CI and their hashes pinned the same way. For local development on those
 * platforms, set ARIA2C_PATH to a system aria2c instead (dev builds only).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface LockEntry {
  url: string;
  archiveSha256: string;
  /** Path of the executable inside the archive. */
  binary: string;
  binarySha256: string;
  /** License file inside the archive, shipped next to the binary. */
  license?: string;
}
interface Lock {
  version: string;
  platforms: Record<string, LockEntry>;
}

const root = path.resolve(import.meta.dirname, '..');
const lockPath = path.join(root, 'binaries.lock.json');
const args = process.argv.slice(2);
const updateLock = args.includes('--update-lock');
const target = args.find((a) => !a.startsWith('--')) ?? `${process.platform}-${process.arch}`;

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function download(url: string, dest: string) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Lock;
  const entry = lock.platforms[target];
  const outDir = path.join(root, 'resources', 'bin', target);
  const exe = path.join(outDir, target.startsWith('win32') ? 'aria2c.exe' : 'aria2c');

  if (!entry) {
    console.warn(
      `No pinned aria2c ${lock.version} for ${target}. Build it statically in CI and add it to binaries.lock.json,\n` +
        `or for local development run with ARIA2C_PATH=/path/to/aria2c.`
    );
    process.exitCode = updateLock ? 1 : 0;
    return;
  }

  if (!updateLock && fs.existsSync(exe) && sha256(exe) === entry.binarySha256) {
    console.log(`aria2c ${lock.version} for ${target} is up to date.`);
    return;
  }

  // Work in a fresh, empty temp directory; nothing from the archive is executed here.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-'));
  try {
    const archive = path.join(tmp, path.basename(new URL(entry.url).pathname));
    console.log(`Downloading ${entry.url}`);
    await download(entry.url, archive);
    const archiveHash = sha256(archive);
    if (!updateLock && archiveHash !== entry.archiveSha256) {
      throw new Error(`Archive SHA-256 mismatch for ${target}: expected ${entry.archiveSha256}, got ${archiveHash}`);
    }
    const extractDir = path.join(tmp, 'x');
    fs.mkdirSync(extractDir);
    // bsdtar (Windows 10+, macOS) reads zip archives; GNU tar handles .tar.* on Linux.
    execFileSync('tar', ['-xf', archive, '-C', extractDir], { stdio: 'inherit' });
    const src = path.join(extractDir, entry.binary);
    const binHash = sha256(src);
    if (!updateLock && binHash !== entry.binarySha256) {
      throw new Error(`aria2c SHA-256 mismatch for ${target}: expected ${entry.binarySha256}, got ${binHash}`);
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(src, exe);
    if (!target.startsWith('win32')) fs.chmodSync(exe, 0o755);
    if (entry.license) fs.copyFileSync(path.join(extractDir, entry.license), path.join(outDir, 'aria2-COPYING.txt'));

    if (updateLock) {
      entry.archiveSha256 = archiveHash;
      entry.binarySha256 = binHash;
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
      console.log(`Pinned ${target}: archive ${archiveHash}, binary ${binHash}`);
    }
    console.log(`aria2c ${lock.version} for ${target} → ${path.relative(root, exe)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
