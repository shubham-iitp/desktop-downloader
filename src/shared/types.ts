// Types shared by the main process, the preload bridge and the renderer.

export type JobKind = 'file' | 'torrent' | 'metalink';
export type JobStatus = 'probing' | 'queued' | 'active' | 'paused' | 'completed' | 'error' | 'cancelled';

/** Which tab of the main window a job belongs to. */
export type Tab = 'torrent' | 'normal';
export const tabOf = (kind: JobKind): Tab => (kind === 'torrent' ? 'torrent' : 'normal');

export type ErrorCode =
  | 'NOT_A_FILE'
  | 'PROBE_FAILED'
  | 'HTTP_ERROR'
  | 'AUTH_REQUIRED'
  | 'DISK_ERROR'
  | 'NETWORK'
  | 'NO_RESUME'
  | 'CHECKSUM_FAILED'
  | 'ENGINE_CRASH'
  | 'FILE_EXISTS'
  | 'UNKNOWN';

export interface JobError {
  code: ErrorCode;
  message: string;
  detail?: string;
}

export interface JobOptions {
  /** File links: parts per file (aria2 split + max-connection-per-server). Torrents: max peers. */
  connections?: number;
  /** Per-job download cap in KB/s; undefined = no per-job cap. */
  speedLimitKBps?: number;
  /** "Name: value" headers (cookies, Authorization, Referer). Stored encrypted. */
  headers?: string[];
  /** 1-based indexes of torrent files to download. */
  selectFiles?: number[];
  /** Overwrite an existing file instead of keeping both. */
  overwrite?: boolean;
}

export interface Job {
  id: string;
  kind: JobKind;
  url: string;
  title: string;
  status: JobStatus;
  dir: string;
  files: string[];
  totalBytes: number | null;
  doneBytes: number;
  speed: number;
  uploadSpeed: number;
  eta: number | null;
  connections: number;
  seeders?: number;
  peers?: number;
  resumable: boolean;
  host?: string;
  /** "2 of 3 files" for a partial torrent selection. */
  selectionNote?: string;
  gid?: string;
  /** Torrents: every file path the torrent can create, selected or not (for Delete). */
  torrentFiles?: string[];
  /** Torrents: v1 info-hash, used to find the download in aria2 whatever its GID. */
  infoHash?: string;
  /** Name aria2 writes the file as (passed as `out` when the job is re-added). */
  outName?: string;
  options: JobOptions;
  error?: JobError;
  retries?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface TorrentFile {
  index: number;
  name: string;
  size: number;
}

export type ProbeKind = 'file' | 'torrent' | 'metalink';

export interface ProbeResult {
  kind: ProbeKind;
  url: string;
  finalUrl?: string;
  filename: string;
  host?: string;
  size?: number | null;
  resumable: boolean;
  protocol?: string;
  files?: TorrentFile[];
  /** Torrent probes leave a paused download in aria2; job:add picks it up by this id. */
  probeId?: string;
  /** Torrent: number of peers metadata was fetched from (magnets). */
  peers?: number;
  /** True when a file with this name already exists in the target folder. */
  exists?: boolean;
  error?: { code: ErrorCode; message: string; status?: number };
}

export interface AddJobRequest {
  url: string;
  kind: JobKind;
  dir?: string;
  filename?: string;
  probeId?: string;
  resumable?: boolean;
  size?: number | null;
  options?: JobOptions;
  /** Set by the "Download anyway" / "Add anyway" overrides. */
  force?: boolean;
}

export interface JobUpdate {
  id: string;
  job?: Job;
  removed?: boolean;
}

/** Speed limits in KB/s: -1 = unlimited, 1 = 1 KB/s, n*1000 = n MB/s (the design's slider scale). */
export type SpeedLimit = number;

export type SeedMode = '0' | '30' | '120' | 'ratio';
export type HistoryKeep = '7' | '30' | '90' | 'forever';
export type ExistsPolicy = 'rename' | 'overwrite' | 'skip' | 'ask';
export type ThemeMode = 'dark' | 'light' | 'system';
export type Density = 'comfortable' | 'compact';

export const FONTS = [
  'Montserrat',
  'Roboto',
  'Open Sans',
  'Lato',
  'Inter',
  'Oswald',
  'Source Sans 3',
  'Raleway',
  'PT Sans',
  'Merriweather'
] as const;
export type FontName = (typeof FONTS)[number];

export interface Settings {
  // General
  startOnLogin: boolean;
  notifyDone: boolean;
  notifyFail: boolean;
  resumeOnLaunch: boolean;
  // Downloads & folders
  dirNormal: string;
  dirTorrent: string;
  connectionsPerFile: number;
  peersPerTorrent: number;
  ifExists: ExistsPolicy;
  prealloc: boolean;
  // Download engine
  maxConcurrent: number;
  downloadLimit: SpeedLimit;
  uploadLimit: SpeedLimit;
  seedMode: SeedMode;
  historyKeep: HistoryKeep;
  // Appearance
  theme: ThemeMode;
  font: FontName;
  density: Density;
}

export type EngineState = 'starting' | 'running' | 'restarting' | 'missing' | 'crashed';

export interface EngineStatus {
  state: EngineState;
  version?: string;
  binPath: string;
  startedAt?: number;
  error?: string;
}

export interface GlobalStat {
  downloadSpeed: number;
  uploadSpeed: number;
  numActive: number;
  numWaiting: number;
}

export interface AppInfo {
  platform: NodeJS.Platform | string;
  version: string;
  isMac: boolean;
}

/** IPC handlers that can fail in user-facing ways return this instead of throwing. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: JobError };

export type CloseChoice = 'hide' | 'quit' | 'cancel';
export type AppCommand = 'open-torrent' | 'settings' | 'ask-close';
