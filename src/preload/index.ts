import { contextBridge, ipcRenderer } from 'electron';
import type { DownloaderApi } from './api';

const on =
  <T>(channel: string) =>
  (cb: (v: T) => void) => {
    const h = (_: unknown, v: T) => cb(v);
    ipcRenderer.on(channel, h);
    return () => {
      ipcRenderer.off(channel, h);
    };
  };

const api: DownloaderApi = {
  probe: (url, opts) => ipcRenderer.invoke('job:probe', url, opts),
  add: (req) => ipcRenderer.invoke('job:add', req),
  pause: (id) => ipcRenderer.invoke('job:pause', id),
  resume: (id) => ipcRenderer.invoke('job:resume', id),
  cancel: (id, deleteFiles) => ipcRenderer.invoke('job:cancel', id, deleteFiles),
  retry: (id) => ipcRenderer.invoke('job:retry', id),
  setConnections: (id, n) => ipcRenderer.invoke('job:setConnections', id, n),
  clearCompleted: (tab) => ipcRenderer.invoke('job:clearCompleted', tab),
  list: () => ipcRenderer.invoke('job:list'),
  reveal: (id) => ipcRenderer.invoke('job:reveal', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFolder: (start) => ipcRenderer.invoke('dialog:pickFolder', start),
  pickTorrent: () => ipcRenderer.invoke('dialog:pickTorrent'),
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  openLog: () => ipcRenderer.invoke('engine:openLog'),
  logTail: () => ipcRenderer.invoke('engine:logTail'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  closeChoice: (c) => ipcRenderer.invoke('app:closeChoice', c),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  onUpdate: on('job:update'),
  onEngineStatus: on('engine:status'),
  onCommand: on('app:command')
};

contextBridge.exposeInMainWorld('dl', api);
