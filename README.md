# Desktop Downloader

A cross-platform download manager (Windows, macOS, Linux) built on Electron, with **aria2c** as its only download engine. One queue for direct file links (HTTP/HTTPS/FTP/SFTP), torrents and magnet links, and Metalink.

## Download (Windows)

From [Releases](https://github.com/shubham-iitp/desktop-downloader/releases/latest):

- **`Desktop-Downloader-Setup-<version>.exe`** is the installer. It adds Start-menu and desktop shortcuts plus an uninstaller, opens `magnet:` links in the app, and gets auto-updates.
- **`Desktop-Downloader-<version>-portable.exe`** needs no install: download and run it. Queue and settings are kept in `%APPDATA%\Desktop Downloader` like the installed app. There are no auto-updates, so download new versions by hand.

The builds aren't code-signed yet, so Windows SmartScreen may warn: **More info → Run anyway**. Compare the file against `SHA256SUMS.txt` in the release.

## Features

- **Two tabs, one queue.** Torrent (magnet links, `.torrent` files) and Normal (file links, Metalink). aria2's parallel-download slots are shared by both tabs.
- **Link check before adding.** Reads the file name, size and resume support. It also catches web pages (`NOT_A_FILE`, with *Download anyway*), 404s, sign-in walls (add cookie/Authorization headers, stored encrypted) and timeouts.
- **Torrent file picker.** Torrents are added paused, their file list is read, and only the files you pick are downloaded.
- **Fast, resumable downloads.** Files are split into up to 16 parts, and paused or unfinished downloads resume after a restart through aria2's session file and `.aria2` control files.
- **Per-row controls.** Connections (or peers) stepper, pause/resume, open folder, remove, and retry plus *Copy details* on a failure. Network errors retry 3× automatically (5 s, 30 s, 2 min).
- **Close button asks:** *Hide to tray* (downloads keep running), *Quit* (saves the session and stops aria2c) or *Cancel*. Tray Quit and Ctrl+Q / ⌘Q quit without asking.
- **Settings.** General, Downloads & folders, Download engine (speed and upload limits, seeding, history) and Appearance (Dark / Light / System theme, 10 fonts, compact density).
- **Repair screen** if aria2c is missing, blocked by antivirus, or keeps crashing.

The UI follows the *Final Version* page of the design: Montserrat, red primary, light and dark.

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

`scripts/fetch-binaries.mts` pins aria2c's version and SHA-256 per platform in `binaries.lock.json`. It downloads only when the binary on disk doesn't match the pin, and refuses mismatches. aria2 publishes an official prebuilt for Windows only. For macOS and Linux, build aria2c statically in CI and add its hashes to the lock file. For local development on those platforms, `ARIA2C_PATH=/path/to/aria2c npm run dev` works in unpackaged builds only.

Icons are generated with `node scripts/make-icons.mjs`.

## Notes

- **Storage:** SQLite through Electron's built-in `node:sqlite`, instead of `better-sqlite3` as in the tech doc. The schema is the same, and there's no native module to rebuild per Electron version or platform.
- **`--continue`** is set per job when the app re-adds its own unfinished downloads, not globally. A global flag would "resume" into unrelated existing files and break *Keep both*.
- **macOS:** aria2c must be signed with the hardened runtime and the app notarized. **Windows:** sign the bundled `aria2c.exe` too.

## Legal

Desktop Downloader is a general-purpose downloader and torrent client. Users are responsible for following copyright law and each site's terms. aria2 is GPL-2.0-or-later and runs as a separate program. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
