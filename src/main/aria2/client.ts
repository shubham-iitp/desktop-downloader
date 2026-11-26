import WebSocket from 'ws';

export type Aria2EventType =
  | 'aria2.onDownloadStart'
  | 'aria2.onDownloadPause'
  | 'aria2.onDownloadStop'
  | 'aria2.onDownloadComplete'
  | 'aria2.onDownloadError'
  | 'aria2.onBtDownloadComplete';

export interface Aria2Event {
  type: Aria2EventType;
  gid: string;
}

export class Aria2Error extends Error {
  code: number;
  constructor(err: { code: number; message: string }) {
    super(err.message);
    this.code = err.code;
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** Typed JSON-RPC 2.0 client over aria2's local WebSocket endpoint. */
export class Aria2Client {
  private ws?: WebSocket;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private closed = false;

  constructor(
    private port: number,
    private secret: string,
    private onEvent: (e: Aria2Event) => void,
    private onClose: () => void = () => {}
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/jsonrpc`);
      const fail = (e: Error) => reject(e);
      ws.once('error', fail);
      ws.once('open', () => {
        ws.off('error', fail);
        this.ws = ws;
        ws.on('message', (raw) => this.handle(raw.toString()));
        ws.on('error', () => {});
        ws.on('close', () => {
          this.rejectAll(new Error('aria2 connection closed'));
          if (!this.closed) this.onClose();
        });
        resolve();
      });
    });
  }

  private handle(text: string) {
    let msg: { id?: string; result?: unknown; error?: { code: number; message: string }; method?: string; params?: { gid: string }[] };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Aria2Error(msg.error));
      else p.resolve(msg.result);
    } else if (msg.method?.startsWith('aria2.on') && msg.params?.[0]?.gid) {
      this.onEvent({ type: msg.method as Aria2EventType, gid: msg.params[0].gid });
    }
  }

  call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('aria2 is not connected'));
    const id = String(++this.seq);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`aria2 call ${method} timed out`));
      }, 15_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: [`token:${this.secret}`, ...params] }));
    });
  }

  /** Batches several calls into one round trip. Each entry is [method, ...params]. */
  async multicall(calls: [string, ...unknown[]][]): Promise<unknown[]> {
    const payload = calls.map(([methodName, ...params]) => ({
      methodName,
      params: [`token:${this.secret}`, ...params]
    }));
    const res = await this.call<unknown[]>('system.multicall', payload);
    // Each result is [value] on success or a fault object.
    return res.map((r) => (Array.isArray(r) ? r[0] : r));
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close() {
    this.closed = true;
    this.rejectAll(new Error('aria2 client closed'));
    this.ws?.close();
  }

  private rejectAll(e: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }
}
