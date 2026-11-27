# Desktop Downloader

A cross-platform download manager (Windows, macOS, Linux) built on Electron. **aria2c** downloads direct file links (HTTP/HTTPS/FTP/SFTP), torrents and magnet links, and Metalink; **yt-dlp** (with ffmpeg and Deno) downloads videos found on web pages.

## Download (Windows)

From [Releases](https://github.com/shubham-iitp/desktop-downloader/releases/latest):

- **`Desktop-Downloader-Setup-<version>.exe`** is the installer. It adds Start-menu and desktop shortcuts plus an uninstaller, and gets auto-updates. On the first launch after a fresh install it asks whether to open `magnet:` links (and `.torrent` files) with Downloader; updates keep your choice. Uninstalling removes the app's data in `%APPDATA%\Desktop Downloader` (queue, settings, the capture browser's logins), so a reinstall starts fresh. Downloaded files are never touched.
- **`Desktop-Downloader-<version>-portable.exe`** needs no install: download and run it. Queue and settings are kept in `%APPDATA%\Desktop Downloader` like the installed app (so uninstalling the installed app clears them too). It asks about `magnet:` links on its first run. There are no auto-updates, so download new versions by hand.

The builds aren't code-signed yet, so Windows SmartScreen may warn: **More info → Run anyway**. Compare the file against `SHA256SUMS.txt` in the release.

## Features

- **Three tabs.** Torrent (magnet links, `.torrent` files) and Normal (file links, Metalink) share aria2's parallel-download slots. Videos has its own 3 yt-dlp slots.
- **Fetch videos (V2).** Paste a page link and pick a Chromium browser (Chrome, Edge, Brave, Chromium, Vivaldi, or one you add with *Browse…*). The page opens in that browser with an app-owned profile, and the app records media requests (HLS, DASH, video files) over the DevTools protocol while you browse. When you close the browser or click *End session*, *Videos found* opens and fills in as yt-dlp scans every page you visited. DRM-protected and unsupported items are left out. Tick videos and pick a quality for each (Best, 2160p–360p, Audio only M4A/MP3); two qualities of one video become two jobs. Captured files go to aria2 with the browser's headers; everything else goes through yt-dlp, which uses ffmpeg to merge streams or extract audio.
- **Link check before adding.** Reads the file name, size and resume support. It also catches web pages (`NOT_A_FILE`, with *Download anyway*), 404s, sign-in walls (add cookie/Authorization headers, stored encrypted) and timeouts.
- **Torrent file picker.** Torrents are added paused, their file list is read, and only the files you pick are downloaded.
- **Fast, resumable downloads.** Files are split into up to 16 parts, and paused or unfinished downloads resume after a restart through aria2's session file and `.aria2` control files.
- **Per-row controls.** Connections (or peers) stepper, pause/resume, open folder, remove, and retry plus *Copy details* on a failure. Network errors retry 3× automatically (5 s, 30 s, 2 min).
- **Close button asks:** *Hide to tray* (downloads keep running), *Quit* (saves the session and stops aria2c) or *Cancel*. Tray Quit and Ctrl+Q / ⌘Q quit without asking.
- **Settings.** General, Downloads & folders, Engines (aria2c, yt-dlp, ffmpeg, Deno; speed and upload limits, seeding, history), Video capture (default browser, added browsers, *Clear capture browser data*) and Appearance (Dark / Light / System theme, 10 fonts, compact density).
- **Repair screen** if aria2c is missing, blocked by antivirus, or keeps crashing.

The UI follows the *Final Version* (V1) and *V2* pages of the design: Montserrat, red primary, light and dark.

## Architecture

```
renderer (React, sandboxed, no Node)  ──window.dl──▶  preload (contextBridge)
        ▲  job:update (batched 250 ms)                    │ ipcRenderer.invoke
        │                                                 ▼
main process: ipc.ts (zod-validated) → JobManager (single source of truth, SQLite)
        │                                                 │ JSON-RPC over ws://127.0.0.1:<port>
        └──────────────── Aria2Daemon ◀───────────────────┘ (per-launch secret, localhost only)
                              │ spawn(shell: false)
                           aria2c 1.37.0 (bundled in resources/bin/<platform>-<arch>/)
```

| Path | What it does |
| --- | --- |
| `src/main/index.ts` | App lifecycle, window, close flow, tray, menu, quit sequence |
| `src/main/aria2/daemon.ts` | Spawns aria2c, picks a port and secret, restarts once after a crash, then reports `crashed` |
| `src/main/aria2/client.ts` | JSON-RPC 2.0 client over WebSocket (+ `system.multicall`) |
| `src/main/jobs/JobManager.ts` | Job ↔ GID mapping, state machine, polling, events, retries, reconcile on startup |
| `src/main/probe.ts`, `probeParse.ts` | HEAD / ranged-GET link check via `net.fetch` (system proxy and certificates) |
| `src/main/db.ts` | SQLite store (jobs, settings); custom headers encrypted with `safeStorage` |
| `src/main/ipc.ts` | IPC handlers with zod schemas and sender-origin checks |
| `src/main/capture/` | Fetch videos: browser detection and the *Browse…* check (`browsers.ts`), the capture session over CDP with puppeteer-core (`session.ts`), response classification, HLS/DASH DRM filters and quality lists (`classify.ts`) |
| `src/main/ytdlp/` | yt-dlp scans, versions and the daily verified self-update (`ytdlp.ts`), and the video job runner, 3 at a time (`runner.ts`) |
| `src/shared/` | Types, job state machine, aria2 error mapping, speed-limit mapping |
| `src/renderer/` | React UI |

Security baseline: `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP (production builds), navigation and new windows blocked, external links limited to `https:`, aria2 RPC bound to localhost with a random per-launch secret, and no shell for child processes. Jobs that carry cookies or Authorization headers are removed from aria2 before it saves its session, then re-added from SQLite on the next launch.

## Development

Requires Node 22+.

```bash
npm install
npm run fetch-binaries   # downloads + verifies the pinned aria2c into resources/bin/
npm run dev              # electron-vite dev server with hot reload
npm test                 # Vitest unit tests
npm run typecheck
npm run dist             # installers via electron-builder (NSIS / DMG / AppImage+deb)
```

`scripts/fetch-binaries.mts` pins the version and SHA-256 of aria2c, yt-dlp, ffmpeg/ffprobe and Deno per platform in `binaries.lock.json` (yt-dlp and Deno are also checked against their published checksums). It downloads only when the binary on disk doesn't match the pin, and refuses mismatches. aria2 publishes an official prebuilt for Windows only. For macOS and Linux, build aria2c statically in CI and add its hashes to the lock file. For local development on those platforms, `ARIA2C_PATH=/path/to/aria2c npm run dev` works in unpackaged builds only.

Icons are generated with `node scripts/make-icons.mjs`.

## Notes

- **Storage:** SQLite through Electron's built-in `node:sqlite`, instead of `better-sqlite3` as in the tech doc. The schema is the same, and there's no native module to rebuild per Electron version or platform.
- **`--continue`** is set per job when the app re-adds its own unfinished downloads, not globally. A global flag would "resume" into unrelated existing files and break *Keep both*.
- **macOS:** aria2c must be signed with the hardened runtime and the app notarized. **Windows:** sign the bundled `aria2c.exe` too.

## Legal

Desktop Downloader is a general-purpose downloader and torrent client. Users are responsible for following copyright law and each site's terms. aria2 is GPL-2.0-or-later and runs as a separate program. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
