import path from 'node:path';
import { app, Menu, nativeImage, Notification, Tray } from 'electron';

export interface TrayHandlers {
  show(): void;
  pauseAll(): void;
  resumeAll(): void;
  quit(): void;
  counts(): { active: number; queued: number; anyRunning: boolean };
}

function iconsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(__dirname, '../../resources/icons');
}

export function appIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(path.join(iconsDir(), 'icon.png'));
}

/** Tray icon (menu-bar icon on macOS) with Show, Pause all / Resume all and Quit. */
export class AppTray {
  private tray?: Tray;
  private notified = false;

  constructor(private h: TrayHandlers) {}

  create(): void {
    const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
    const img = nativeImage.createFromPath(path.join(iconsDir(), file));
    if (process.platform === 'darwin') img.setTemplateImage(true);
    this.tray = new Tray(img);
    this.tray.setToolTip('Desktop Downloader');
    this.tray.on('click', () => {
      if (process.platform !== 'darwin') this.h.show();
    });
    this.tray.on('right-click', () => this.tray?.popUpContextMenu(this.menu()));
    this.refresh();
  }

  private menu(): Menu {
    const { active, queued, anyRunning } = this.h.counts();
    const header =
      active + queued
        ? `Downloader · ${active} downloading${queued ? `, ${queued} queued` : ''}`
        : 'Downloader · nothing downloading';
    return Menu.buildFromTemplate([
      { label: header, enabled: false },
      { label: 'Show Downloader', click: () => this.h.show() },
      anyRunning
        ? { label: 'Pause all', click: () => this.h.pauseAll() }
        : { label: 'Resume all', click: () => this.h.resumeAll() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.h.quit() }
    ]);
  }

  /** Rebuilds the menu so its header and Pause/Resume label stay current. */
  refresh(): void {
    if (!this.tray) return;
    this.tray.setContextMenu(this.menu());
  }

  /** The first time the window hides, say the app is still running. */
  notifyFirstHide(alreadyShown: boolean, markShown: () => void): void {
    if (alreadyShown || this.notified || !Notification.isSupported()) return;
    this.notified = true;
    markShown();
    const { active, queued } = this.h.counts();
    const n = active + queued;
    const body =
      (n ? `${n} download${n === 1 ? ' continues' : 's continue'} in the background. ` : '') +
      'Click the tray icon to open it again or quit. You’ll only see this once.';
    const note = new Notification({ title: 'Downloader is still running', body, icon: appIcon() });
    note.on('click', () => this.h.show());
    note.show();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}
