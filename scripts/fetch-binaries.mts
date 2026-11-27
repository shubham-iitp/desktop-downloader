/*
 * Downloads and verifies the pinned engine binaries (aria2c, yt-dlp, ffmpeg/ffprobe, Deno)
 * for the current (or given) platform into resources/bin/<platform>-<arch>/. Runs in CI
 * before packaging.
 *
 *   node scripts/fetch-binaries.mts                 # current platform
 *   node scripts/fetch-binaries.mts win32-x64       # a specific target
 *   node scripts/fetch-binaries.mts --update-lock   # record hashes of what was downloaded
 *
 * A tool is downloaded only when one of its files on disk doesn't match the pinned SHA-256.
 * With --update-lock, a tool whose project publishes checksums (`checksumUrl`) is still
 * checked against them, so a new pin never trusts the download alone.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface LockEntry {
  url: string;
  /** SHA-256 of the download (the archive, or the binary itself when `files` has no `from`). */
  sha256: string;
  /** Published checksum list (`<hash>  <name>` lines) used to cross-check the download. */
  checksumUrl?: string;
  /** Output file name → where it is inside the archive (omit `from` for a bare binary) and its hash. */
  files: Record<string, { from?: string; sha256: string }>;
}
interface Tool {
  version: string;
  platforms: Record<string, LockEntry>;
}
interface Lock {
  tools: Record<string, Tool>;
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

/** The hash a published checksum list gives for `name`, or the only hash in a one-line file. */
async function publishedHash(url: string, name: string): Promise<string | undefined> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Checksum download failed: HTTP ${res.status} for ${url}`);
  const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = l.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m && path.basename(m[2].trim()) === name) return m[1].toLowerCase();
  }
  // PowerShell Get-FileHash format (Deno's .sha256sum): "Hash : <hex>"
  const ps = lines.join('\n').match(/Hash\s*:\s*([0-9a-f]{64})/i);
  if (ps) return ps[1].toLowerCase();
  return lines.length === 1 && /^[0-9a-f]{64}$/i.test(lines[0]) ? lines[0].toLowerCase() : undefined;
}

async function fetchTool(name: string, tool: Tool, entry: LockEntry, outDir: string): Promise<void> {
  const upToDate =
    !updateLock && Object.entries(entry.files).every(([out, f]) => fs.existsSync(path.join(outDir, out)) && sha256(path.join(outDir, out)) === f.sha256);
  if (upToDate) {
    console.log(`${name} ${tool.version} for ${target} is up to date.`);
    return;
  }
  // Work in a fresh, empty temp directory; nothing downloaded is executed here.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try {
    const base = path.basename(new URL(entry.url).pathname);
    const dl = path.join(tmp, base);
    console.log(`Downloading ${entry.url}`);
    await download(entry.url, dl);
    const dlHash = sha256(dl);
    if (entry.checksumUrl) {
      const pub = await publishedHash(entry.checksumUrl, base);
      if (!pub) throw new Error(`${entry.checksumUrl} lists no checksum for ${base}`);
      if (pub !== dlHash) throw new Error(`${base} doesn't match the published SHA-256: expected ${pub}, got ${dlHash}`);
    }
    if (!updateLock && dlHash !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${base} (${target}): expected ${entry.sha256}, got ${dlHash}`);
    }
    const isArchive = Object.values(entry.files).some((f) => f.from);
    const extractDir = path.join(tmp, 'x');
    if (isArchive) {
      fs.mkdirSync(extractDir);
      // bsdtar (Windows 10+, macOS) reads zip archives; GNU tar handles .tar.* on Linux. On Windows
      // use System32's bsdtar by path: a GNU tar from Git Bash on PATH reads "C:" as a remote host.
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      execFileSync(tar, ['-xf', dl, '-C', extractDir], { stdio: 'inherit' });
    }
    fs.mkdirSync(outDir, { recursive: true });
    for (const [out, f] of Object.entries(entry.files)) {
      const src = f.from ? path.join(extractDir, f.from) : dl;
      const h = sha256(src);
      if (!updateLock && h !== f.sha256) throw new Error(`${out} SHA-256 mismatch (${target}): expected ${f.sha256}, got ${h}`);
      const dest = path.join(outDir, out);
      fs.copyFileSync(src, dest);
      if (!target.startsWith('win32') && !/\.(txt|md)$/i.test(out)) fs.chmodSync(dest, 0o755);
      f.sha256 = h;
    }
    entry.sha256 = dlHash;
    console.log(`${name} ${tool.version} for ${target} → ${path.relative(root, outDir)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Lock;
  const outDir = path.join(root, 'resources', 'bin', target);
  let missing = 0;
  for (const [name, tool] of Object.entries(lock.tools)) {
    const entry = tool.platforms[target];
    if (!entry) {
      missing++;
      console.warn(`No pinned ${name} ${tool.version} for ${target}. Build or download it in CI and add it to binaries.lock.json.`);
      continue;
    }
    await fetchTool(name, tool, entry, outDir);
  }
  if (updateLock) {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    console.log('binaries.lock.json updated.');
    if (missing) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
