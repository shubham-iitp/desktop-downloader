// Types shared by the main process, the preload bridge and the renderer.

export type JobKind = 'file' | 'torrent' | 'metalink' | 'media';
/** `postprocessing` = ffmpeg merging or extracting audio, yt-dlp jobs only. */
export type JobStatus = 'probing' | 'queued' | 'active' | 'postprocessing' | 'paused' | 'completed' | 'error' | 'cancelled';

/** Which tab of the main window a job belongs to. */
export type Tab = 'torrent' | 'normal' | 'videos';
export const tabOf = (kind: JobKind): Tab => (kind === 'torrent' ? 'torrent' : kind === 'media' ? 'videos' : 'normal');

/** Which program downloads a job. Everything except yt-dlp video jobs runs through aria2. */
export type Engine = 'aria2' | 'ytdlp';

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
  | 'LINK_EXPIRED'
  | 'FORMAT_UNAVAILABLE'
  | 'MERGE_FAILED'
  | 'EXTRACTOR'
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
  /** Video jobs: which engine runs it (missing = aria2). */
  engine?: Engine;
  media?: MediaSpec;
  /** While postprocessing: what ffmpeg is doing ("Merging video and audio…"). */
  postNote?: string;
  error?: JobError;
  retries?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** How a video job was found and which version of it was picked. */
export interface MediaSpec {
  source: 'ytdlp' | 'captured';
  /** Stream type the job downloads. */
  type: 'ytdlp' | 'hls' | 'dash' | 'progressive';
  /** Quality key from the popup: best, 2160 … 360, m4a, mp3, file, or a captured variant's height. */
  quality: string;
  /** Page the video was found on, re-scanned once if a captured link has expired. */
  pageUrl?: string;
  /** Netscape cookies.txt from the capture session, for yt-dlp. */
  cookieFile?: string;
  /** True once the source page was re-scanned after a 403. */
  rescanned?: boolean;
  /** yt-dlp jobs: true after the one automatic retry for "format unavailable". */
  formatRetried?: boolean;
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
  /** kind 'media': the popup row and quality. The main process looks up the URL and headers itself. */
  media?: { sessionId: string; itemId: string; quality: string };
}

// ---------------------------------------------------------------- V2: video capture

/** A Chromium-based browser Fetch videos can launch. */
export interface Browser {
  id: string;
  name: string;
  path: string;
  /** Added by the user with Browse… (verified, saved in settings). */
  custom: boolean;
  /** The browser's own icon as a data: URL, when it could be read. */
  icon?: string;
}

export interface CustomBrowser {
  id: string;
  name: string;
  path: string;
}

export interface QualityOption {
  key: string;
  label: string;
  /** "48 MB", "~210 MB", or '' when unknown. */
  size: string;
}

/** One downloadable video in the "Videos found" popup. */
export interface CaptureItem {
  id: string;
  title: string;
  /** "youtube.com · found on keebblog.example.com/switch-roundup" */
  source: string;
  /** Seconds, if known. */
  duration?: number;
  /** data: URL (the renderer loads nothing remote). */
  thumbnail?: string;
  type: 'ytdlp' | 'hls' | 'dash' | 'progressive';
  qualities: QualityOption[];
  defaultQuality: string;
}

export interface VisitedPage {
  url: string;
  /** "yt-dlp: 2 videos", "HLS seen", "yt-dlp after session" */
  tag: string;
  ok: boolean;
}

export type CapturePhase = 'starting' | 'browsing' | 'scanning' | 'done';

export interface CaptureUpdate {
  sessionId: string;
  phase: CapturePhase;
  /** The link the session was started on. */
  url: string;
  browserId: string;
  browserName: string;
  pages: VisitedPage[];
  mediaSeen: number;
  progress: { done: number; total: number };
  items: CaptureItem[];
  /** Set when the session couldn't start. */
  error?: string;
}

export type CaptureStartError = 'NO_BROWSER' | 'NO_START' | 'BUSY' | 'BAD_URL';

export interface EngineInfo {
  name: string;
  version: string;
  source: 'Bundled' | 'Updated copy';
  ready: boolean;
  path: string;
}

export interface EnginesStatus {
  ytdlp: EngineInfo & { checking: boolean; note: string };
  ffmpeg: EngineInfo;
  deno: EngineInfo;
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
  dirVideos: string;
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
  // Video capture
  /** Default browser id for Fetch videos ('' = the first one found). */
  captureBrowser: string;
  customBrowsers: CustomBrowser[];
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

/** Whether Downloader is what opens magnet: links and .torrent files right now. */
export interface DefaultsState {
  magnet: boolean;
  torrent: boolean;
  /** .torrent file handling can be switched from the app (Windows). */
  torrentSupported: boolean;
}
export type AppCommand = 'open-torrent' | 'settings' | 'ask-close';
