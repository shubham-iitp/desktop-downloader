import { execFile } from 'node:child_process';
import { app, shell } from 'electron';
import type { DefaultsState } from '@shared/types';
import { log } from './log';

/*
 * Downloader as the app for magnet: links and .torrent files.
 *
 * Windows: besides the plain magnet: / .torrent keys, the app registers itself properly
 * (ProgIds, Capabilities, RegisteredApplications under HKCU, no admin needed), so it is
 * listed in Settings › Default apps. Windows protects a choice the user made there
 * (UserChoice): an app can't override it, so when one points elsewhere the app opens
 * Default apps for the user to confirm. macOS / Linux: magnet: through Electron's
 * protocol-client API; .torrent files come from the installer's file associations.
 */

const MAGNET_PROGID = 'DesktopDownloader.Magnet';
const TORRENT_PROGID = 'DesktopDownloader.Torrent';
const CAPS = 'Software\\DesktopDownloader\\Capabilities';
const APP_NAME = 'Desktop Downloader';
const HKCU = 'HKCU\\';

const isWin = process.platform === 'win32';

/** The exe the user runs: the portable exe itself, not its unpacked temp copy. */
export function appExe(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function reg(args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true, timeout: 10_000 }, (err, out) => resolve(err ? undefined : out));
  });
}

/** A registry value (default value when `name` is omitted), or undefined. */
async function regGet(key: string, name?: string): Promise<string | undefined> {
  const out = await reg(['query', key, ...(name ? ['/v', name] : ['/ve'])]);
  const m = out?.match(/REG_(?:EXPAND_)?SZ\s+(.*)$/m);
  return m ? m[1].trim() : undefined;
}

const regSet = (key: string, name: string | undefined, value: string) =>
  reg(['add', key, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f']);
const regDelKey = (key: string) => reg(['delete', key, '/f']);

const command = () => `"${appExe()}" "%1"`;
const pointsHere = (cmd: string | undefined) => !!cmd && cmd.toLowerCase().includes(appExe().toLowerCase());

/** ProgIds, Capabilities and RegisteredApplications: lists Downloader in Default apps. */
async function registerCapabilities(): Promise<void> {
  const exe = appExe();
  for (const [progId, label] of [
    [MAGNET_PROGID, 'Magnet link'],
    [TORRENT_PROGID, 'Torrent file']
  ] as const) {
    const k = `${HKCU}Software\\Classes\\${progId}`;
    await regSet(k, undefined, label);
    if (progId === MAGNET_PROGID) await regSet(k, 'URL Protocol', '');
    await regSet(`${k}\\DefaultIcon`, undefined, `"${exe}",0`);
    await regSet(`${k}\\shell\\open\\command`, undefined, command());
  }
  await regSet(`${HKCU}${CAPS}`, 'ApplicationName', APP_NAME);
  await regSet(`${HKCU}${CAPS}`, 'ApplicationDescription', 'Downloads files, torrents and videos.');
  await regSet(`${HKCU}${CAPS}\\URLAssociations`, 'magnet', MAGNET_PROGID);
  await regSet(`${HKCU}${CAPS}\\FileAssociations`, '.torrent', TORRENT_PROGID);
  await regSet(`${HKCU}Software\\RegisteredApplications`, APP_NAME, CAPS);
}

async function winMagnetIsOurs(): Promise<boolean> {
  const choice = await regGet(`${HKCU}Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\magnet\\UserChoice`, 'ProgId');
  if (choice) return choice === MAGNET_PROGID || (choice.toLowerCase() === 'magnet' && pointsHere(await regGet('HKCR\\magnet\\shell\\open\\command')));
  return pointsHere(await regGet('HKCR\\magnet\\shell\\open\\command'));
}

async function winTorrentIsOurs(): Promise<boolean> {
  const choice = await regGet(`${HKCU}Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.torrent\\UserChoice`, 'ProgId');
  if (choice) return choice === TORRENT_PROGID;
  return (await regGet('HKCR\\.torrent')) === TORRENT_PROGID;
}

/** What actually opens magnet: links and .torrent files right now. */
export async function getDefaults(): Promise<DefaultsState> {
  if (isWin) return { magnet: await winMagnetIsOurs(), torrent: await winTorrentIsOurs(), torrentSupported: true };
  return { magnet: app.isDefaultProtocolClient('magnet'), torrent: false, torrentSupported: false };
}

/** True when no app at all handles magnet: links. */
export function noMagnetHandler(): boolean {
  return !app.getApplicationNameForProtocol('magnet:?xt=urn:btih:0');
}

/**
 * Turns magnet: / .torrent handling on or off. Off only removes registrations that point at
 * this app. When Windows keeps another app (a protected Default apps choice), `blocked` is
 * true and Default apps is opened on Downloader's page.
 */
export async function setDefaults(want: { magnet?: boolean; torrent?: boolean }): Promise<DefaultsState & { blocked: boolean }> {
  // A development run would point links at the bare Electron binary: change nothing.
  if (!app.isPackaged) {
    log.info(`defaults: dev run, not registering ${JSON.stringify(want)}`);
    return { ...(await getDefaults()), blocked: false };
  }
  if (!isWin) {
    if (want.magnet === true) app.setAsDefaultProtocolClient('magnet');
    if (want.magnet === false) app.removeAsDefaultProtocolClient('magnet');
    return { ...(await getDefaults()), blocked: false };
  }
  await registerCapabilities();
  if (want.magnet === true) {
    const k = `${HKCU}Software\\Classes\\magnet`;
    await regSet(k, undefined, 'URL:Magnet link');
    await regSet(k, 'URL Protocol', '');
    await regSet(`${k}\\DefaultIcon`, undefined, `"${appExe()}",0`);
    await regSet(`${k}\\shell\\open\\command`, undefined, command());
  } else if (want.magnet === false && pointsHere(await regGet(`${HKCU}Software\\Classes\\magnet\\shell\\open\\command`))) {
    await regDelKey(`${HKCU}Software\\Classes\\magnet`);
  }
  if (want.torrent === true) {
    await regSet(`${HKCU}Software\\Classes\\.torrent`, undefined, TORRENT_PROGID);
    await regSet(`${HKCU}Software\\Classes\\.torrent\\OpenWithProgids`, TORRENT_PROGID, '');
  } else if (want.torrent === false && (await regGet(`${HKCU}Software\\Classes\\.torrent`)) === TORRENT_PROGID) {
    await reg(['delete', `${HKCU}Software\\Classes\\.torrent`, '/ve', '/f']);
  }
  const now = await getDefaults();
  const blocked = (want.magnet === true && !now.magnet) || (want.torrent === true && !now.torrent);
  if (blocked) {
    log.info('defaults: Windows kept another app; opening Default apps');
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(APP_NAME)}`).catch(() => shell.openExternal('ms-settings:defaultapps'));
  }
  return { ...now, blocked };
}
