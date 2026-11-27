# Third-party notices

## aria2

Desktop Downloader bundles **aria2c 1.37.0** (https://aria2.github.io/), licensed under the GNU General Public License, version 2 or later.

aria2c is shipped unmodified as a separate executable and the app talks to it over JSON-RPC; it is not linked into the app. The full license text ships next to the binary as `aria2-COPYING.txt` (copied from the official release archive by `scripts/fetch-binaries.mts`).

**Written offer of source:** the complete corresponding source code for the bundled aria2c is available from https://github.com/aria2/aria2/releases/tag/release-1.37.0. On request, the project maintainers will also provide a copy, for at least three years from the date of each release, for no more than the cost of distribution.

## yt-dlp

**yt-dlp 2026.11.23** (https://github.com/yt-dlp/yt-dlp), the official standalone build, is released into the public domain under the Unlicense. Its standalone build includes `yt-dlp-ejs` and the Python runtime with their own permissive licenses. The app keeps it current by downloading newer official releases into its data folder after checking their SHA-256.

## FFmpeg

**FFmpeg 9.1** (https://ffmpeg.org/), as the "essentials" Windows build by Gyan Doshi (https://www.gyan.dev/ffmpeg/builds/, mirrored at https://github.com/GyanD/codexffmpeg), licensed under the GNU General Public License, version 3. `ffmpeg.exe` and `ffprobe.exe` are shipped unmodified as separate executables that yt-dlp runs; the license text ships next to them as `ffmpeg-LICENSE.txt`.

**Written offer of source:** the corresponding source is available from https://github.com/GyanD/codexffmpeg/releases/tag/9.1 and https://ffmpeg.org/releases/. On request, the project maintainers will also provide a copy, for at least three years from the date of each release, for no more than the cost of distribution.

## Deno

**Deno 2.9.8** (https://deno.com/), MIT-licensed, ships unmodified as the JavaScript runtime yt-dlp uses for some sites' player code.

## Fonts

Montserrat, Inter, Roboto, Open Sans, Lato, Oswald, Source Sans 3, Raleway, PT Sans and Merriweather are bundled via Fontsource under the SIL Open Font License 1.1 (Roboto: Apache License 2.0).

## Electron and npm dependencies

Electron, React, ws and zod are MIT-licensed; electron-updater is MIT; puppeteer-core is Apache-2.0. See each package's LICENSE in `node_modules`.
