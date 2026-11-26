# Third-party notices

## aria2

Desktop Downloader bundles **aria2c 1.37.0** (https://aria2.github.io/), licensed under the GNU General Public License, version 2 or later.

aria2c is shipped unmodified as a separate executable and the app talks to it over JSON-RPC; it is not linked into the app. The full license text ships next to the binary as `aria2-COPYING.txt` (copied from the official release archive by `scripts/fetch-binaries.ts`).

**Written offer of source:** the complete corresponding source code for the bundled aria2c is available from https://github.com/aria2/aria2/releases/tag/release-1.37.0. On request, the project maintainers will also provide a copy, for at least three years from the date of each release, for no more than the cost of distribution.

## Fonts

Montserrat, Inter, Roboto, Open Sans, Lato, Oswald, Source Sans 3, Raleway, PT Sans and Merriweather are bundled via Fontsource under the SIL Open Font License 1.1 (Roboto: Apache License 2.0).

## Electron and npm dependencies

Electron, React, ws and zod are MIT-licensed; electron-updater is MIT. See each package's LICENSE in `node_modules`.
