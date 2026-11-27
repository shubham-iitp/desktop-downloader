import type {
  AddJobRequest,
  AppCommand,
  AppInfo,
  Browser,
  CaptureStartError,
  CaptureUpdate,
  EnginesStatus,
  CloseChoice,
  EngineStatus,
  Job,
  JobUpdate,
  ProbeResult,
  Result,
  Settings,
  Tab
} from '../shared/types';

/** The typed API the preload exposes to the renderer as `window.dl`. */
export interface DownloaderApi {
  probe(url: string, opts?: { headers?: string[]; dir?: string }): Promise<Result<ProbeResult>>;
  add(req: AddJobRequest): Promise<Result<Job>>;
  pause(id: string): Promise<Result<Job>>;
  resume(id: string): Promise<Result<Job>>;
  cancel(id: string, deleteFiles: boolean): Promise<Result<void>>;
  retry(id: string): Promise<Result<Job>>;
  setConnections(id: string, n: number): Promise<Result<Job>>;
  clearCompleted(tab: Tab): Promise<Result<void>>;
  list(): Promise<Job[]>;
  reveal(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  pickFolder(start?: string): Promise<string | null>;
  pickTorrent(): Promise<string | null>;
  engineStatus(): Promise<EngineStatus>;
  restartEngine(): Promise<void>;
  openLog(): Promise<void>;
  logTail(): Promise<string>;
  appInfo(): Promise<AppInfo>;
  closeChoice(c: CloseChoice): Promise<void>;
  quit(): Promise<void>;
  /** A magnet link the app was launched with, if the renderer hasn't taken it yet. */
  takePendingLink(): Promise<string | null>;
  /** A magnet link clicked while the app is running. */
  onOpenLink(cb: (link: string) => void): () => void;
  openExternal(url: string): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  closeWindow(): Promise<void>;
  onUpdate(cb: (u: JobUpdate[]) => void): () => void;
  onEngineStatus(cb: (s: EngineStatus) => void): () => void;
  onCommand(cb: (c: AppCommand) => void): () => void;

  // V2: Fetch videos
  browsers(): Promise<Browser[]>;
  /** File dialog + Chromium check. null = cancelled. */
  addBrowser(): Promise<Browser | { error: 'NOT_CHROMIUM' } | null>;
  removeBrowser(id: string): Promise<Settings>;
  startCapture(url: string, browserId: string): Promise<{ sessionId: string } | { error: CaptureStartError; message?: string }>;
  endCapture(sessionId: string): Promise<void>;
  discardCapture(sessionId: string): Promise<void>;
  currentCapture(): Promise<CaptureUpdate | null>;
  clearCaptureData(): Promise<boolean>;
  onCapture(cb: (u: CaptureUpdate | null) => void): () => void;
  enginesStatus(): Promise<EnginesStatus>;
  checkYtdlp(): Promise<EnginesStatus>;
  onEngines(cb: (s: EnginesStatus) => void): () => void;
}

declare global {
  interface Window {
    dl: DownloaderApi;
  }
}
