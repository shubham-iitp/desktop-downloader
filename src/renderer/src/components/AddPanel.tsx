import { useEffect, useRef, useState } from 'react';
import type { AddJobRequest, JobError, ProbeResult, Settings, Tab } from '@shared/types';
import { formatBytes } from '@shared/limits';
import { Clipboard, FileIcon, Folder, Plus, Search } from '../icons';

interface Props {
  tab: Tab;
  settings: Settings;
  openTorrentTick: number;
  /** A magnet link opened from outside the app: fill the box and load its file list. */
  incoming?: { url: string; id: number } | null;
  onIncomingTaken?: () => void;
}

function validate(tab: Tab, link: string): string {
  if (!link) return 'Paste a link first.';
  const local = !/^[a-z][a-z0-9+.-]*:/i.test(link) || /^[a-z]:\\/i.test(link);
  if (tab === 'torrent') {
    if (link.toLowerCase().startsWith('magnet:') || /\.torrent(\?.*)?$/i.test(link)) return '';
    return 'Use a magnet link or a .torrent file here. Direct file links go in the Normal tab.';
  }
  if (/^magnet:/i.test(link)) return 'That’s a magnet link. Use the Torrent tab.';
  if (local && /\.(meta4|metalink)$/i.test(link)) return '';
  if (!/^(https?|s?ftp):\/\//i.test(link)) return 'Links need to start with http://, https://, ftp:// or sftp://';
  return '';
}

type Failure = { title: string; msg: string; canHeaders?: boolean; canForce?: boolean };

function failureOf(tab: Tab, e: { code: string; message: string; status?: number }): Failure {
  if (tab === 'torrent') return { title: 'Couldn’t get the file list', msg: e.message, canForce: e.code === 'PROBE_FAILED' };
  switch (e.code) {
    case 'AUTH_REQUIRED':
      return { title: `HTTP ${e.status ?? 401} · Sign-in required`, msg: e.message, canHeaders: true };
    case 'HTTP_ERROR':
      return { title: `HTTP ${e.status ?? ''} · ${e.status === 404 ? 'File not found' : 'Server error'}`, msg: e.message };
    case 'PROBE_FAILED':
      return { title: 'The server didn’t answer', msg: e.message, canForce: true };
    default:
      return { title: 'Couldn’t check this link', msg: e.message, canForce: true };
  }
}

/** "Add a torrent" / "Add a file link" panel: link box, Check link, probe result, Save to, Add to queue. */
export function AddPanel({ tab, settings, openTorrentTick, incoming, onIncomingTaken }: Props) {
  const isT = tab === 'torrent';
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [folder, setFolder] = useState(isT ? settings.dirTorrent : settings.dirNormal);
  const [showHeaders, setShowHeaders] = useState(false);
  const [headersText, setHeadersText] = useState('');
  const [existsPrompt, setExistsPrompt] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const probeSeq = useRef(0);
  const lastTick = useRef(openTorrentTick);

  useEffect(() => {
    setFolder(isT ? settings.dirTorrent : settings.dirNormal);
  }, [isT, settings.dirTorrent, settings.dirNormal]);

  const headers = () =>
    headersText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[A-Za-z0-9-]+\s*:/.test(l));

  const reset = () => {
    setProbe(null);
    setFailure(null);
    setExistsPrompt(null);
  };

  const runProbe = async (target: string, andAdd: boolean) => {
    const url = target.trim();
    const err = validate(tab, url);
    if (err) {
      setError(err);
      reset();
      return;
    }
    if (probe && probe.url === url && !failure) {
      // A web page needs an explicit "Download anyway".
      if (andAdd && !probe.error) await add(probe);
      return;
    }
    const seq = ++probeSeq.current;
    setError('');
    reset();
    setProbing(true);
    const res = await window.dl.probe(url, { headers: headers(), dir: folder });
    if (seq !== probeSeq.current) return; // superseded
    setProbing(false);
    if (!res.ok) {
      setFailure(failureOf(tab, res.error));
      setProbe({ kind: isT ? 'torrent' : 'file', url, filename: '', resumable: true, error: { code: res.error.code, message: res.error.message } });
      return;
    }
    const p = res.value;
    setProbe(p);
    if (p.error && p.error.code !== 'NOT_A_FILE') setFailure(failureOf(tab, p.error));
    if (p.files) setSelected(new Set(p.files.map((f) => f.index)));
    if (andAdd && !p.error) await add(p);
  };

  const add = async (p: ProbeResult, opts: { force?: boolean; overwrite?: boolean } = {}) => {
    const files = p.files ?? [];
    if (p.kind === 'torrent' && files.length && selected.size === 0 && !p.error) {
      setError('Pick at least one file from the torrent.');
      return;
    }
    const partial = p.kind === 'torrent' && files.length > 0 && selected.size < files.length;
    const h = headers();
    const req: AddJobRequest = {
      url: p.url,
      kind: p.kind,
      dir: folder,
      filename: p.kind === 'file' && p.filename && p.error?.code !== 'NOT_A_FILE' ? p.filename : undefined,
      probeId: p.probeId,
      resumable: p.resumable,
      size: p.size ?? null,
      force: opts.force,
      options: {
        ...(h.length ? { headers: h } : {}),
        ...(partial ? { selectFiles: [...selected].sort((a, b) => a - b) } : {}),
        ...(opts.overwrite !== undefined ? { overwrite: opts.overwrite } : {})
      }
    };
    setAdding(true);
    const res = await window.dl.add(req);
    setAdding(false);
    if (res.ok) {
      setLink('');
      setError('');
      reset();
      setShowHeaders(false);
      return;
    }
    handleAddError(res.error);
  };

  const handleAddError = (e: JobError) => {
    if (e.code === 'FILE_EXISTS' && settings.ifExists === 'ask') setExistsPrompt(e.message);
    else setError(e.message);
  };

  const openTorrent = async () => {
    const file = await window.dl.pickTorrent();
    if (!file) return;
    setLink(file);
    await runProbe(file, false);
  };

  // File › Open .torrent file… / Ctrl+O
  useEffect(() => {
    if (openTorrentTick !== lastTick.current && isT) {
      lastTick.current = openTorrentTick;
      void openTorrent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTorrentTick, isT]);

  // Magnet link clicked in a browser: paste it and fetch the file list (adding still needs a click).
  useEffect(() => {
    if (!incoming || !isT) return;
    onIncomingTaken?.();
    setLink(incoming.url);
    setError('');
    void runProbe(incoming.url, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.id, isT]);

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      setLink(t);
      setError('');
      reset();
    } catch {
      setError('Clipboard is blocked here. Press Ctrl+V in the box instead.');
    }
  };

  const browse = async () => {
    const dir = await window.dl.pickFolder(folder);
    if (dir) setFolder(dir);
  };

  const p = probe;
  const showFile = !!p && !p.error && (p.kind === 'file' || p.kind === 'metalink');
  const showHtml = !!p && p.error?.code === 'NOT_A_FILE';
  const showTorrentFiles = !!p && !p.error && p.kind === 'torrent' && !!p.files;
  const fileNote = !p
    ? ''
    : p.kind === 'metalink'
      ? 'aria2c picks the fastest mirrors and checks each piece against the published checksum.'
      : p.protocol === 'FTP' || p.protocol === 'SFTP'
        ? 'Size and resume support come from the server once the download starts.'
        : !p.resumable
          ? 'The server doesn’t accept range requests, so this file downloads over 1 connection and can’t be split.'
          : p.size == null
            ? 'The server didn’t send a file size. Progress will show bytes downloaded instead of a percentage.'
            : '';
  const existsNote =
    p?.exists && settings.ifExists !== 'ask'
      ? settings.ifExists === 'rename'
        ? 'A file with this name is already in the folder; the new one gets a number.'
        : settings.ifExists === 'overwrite'
          ? 'A file with this name is already in the folder and will be replaced.'
          : 'A file with this name is already in the folder, so this download will be skipped.'
      : '';

  return (
    <div
      style={{
        flex: '1 1 300px',
        maxWidth: 380,
        minWidth: 280,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{isT ? 'Add a torrent' : 'Add a file link'}</h2>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {isT ? 'Magnet links and .torrent files, downloaded by aria2c' : 'HTTP, HTTPS, FTP, SFTP and Metalink, downloaded by aria2c'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="dl-link" className="label">
          Link
        </label>
        <textarea
          id="dl-link"
          className="input mono"
          rows={3}
          placeholder={isT ? 'magnet:?xt=urn:btih:…' : 'https://example.com/file.zip'}
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError('');
            if (p && e.target.value.trim() !== p.url) reset();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void runProbe(link, true);
            }
          }}
          style={{ resize: 'none', fontSize: 12, lineHeight: 1.5 }}
        />
        {error && <div style={{ fontSize: 12, color: 'var(--err)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void paste()} style={{ flex: 1, height: 34, fontSize: 13 }}>
            <Clipboard />
            Paste
          </button>
          <button className="btn" onClick={() => void runProbe(link, false)} disabled={probing} style={{ flex: 1, height: 34, fontSize: 13 }}>
            <Search />
            {probing ? (isT ? 'Fetching…' : 'Checking…') : isT ? 'Show files' : 'Check link'}
          </button>
        </div>
        {isT && (
          <button className="btn" onClick={() => void openTorrent()} style={{ height: 34, fontSize: 13 }}>
            <FileIcon />
            Open .torrent file…
          </button>
        )}
      </div>

      {probing && (
        <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{isT ? 'Fetching torrent details…' : 'Checking link…'}</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {isT
              ? 'Asking peers for the file list. Magnet links can take a little while.'
              : 'Reading the file name, size and whether it can resume. Gives up after 5 seconds.'}
          </div>
          <div className="bar indeterminate" style={{ height: 4 }}>
            <div style={{ background: 'var(--accent)' }} />
          </div>
        </div>
      )}

      {showFile && p && (
        <div style={{ border: '1px solid var(--line)', background: 'var(--panel2)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' }}>{p.filename}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {[p.kind === 'metalink' ? 'Metalink' : p.host, p.size != null ? formatBytes(p.size) : 'Size unknown', p.protocol].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: p.kind === 'metalink' || p.resumable ? 'var(--ok)' : 'var(--warn)' }}>
            {p.kind === 'metalink'
              ? 'Resumable · checksums verified'
              : p.resumable
                ? 'Resumable · can be split into parts'
                : 'No resume · a pause restarts from 0'}
          </div>
          {fileNote && (
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {fileNote}
            </div>
          )}
          {existsNote && <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--warn)' }}>{existsNote}</div>}
        </div>
      )}

      {failure && (
        <div style={{ border: '1px solid var(--err)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--err)' }}>{failure.title}</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {failure.msg}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => (reset(), void runProbe(link, false))} style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500 }}>
              Check again
            </button>
            {failure.canHeaders && (
              <button className="btn" onClick={() => setShowHeaders(true)} style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600 }}>
                Add headers…
              </button>
            )}
            {failure.canForce && p && (
              <button className="btn" onClick={() => void add(p, { force: true })} style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600 }}>
                Add anyway
              </button>
            )}
          </div>
        </div>
      )}

      {(showHeaders || headersText) && !isT && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="dl-headers" className="label">
            Request headers (one per line, stored encrypted)
          </label>
          <textarea
            id="dl-headers"
            className="input mono"
            rows={3}
            placeholder={'Cookie: session=…\nAuthorization: Bearer …'}
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            style={{ resize: 'vertical', fontSize: 12, lineHeight: 1.5 }}
          />
        </div>
      )}

      {showHtml && p && (
        <div style={{ border: '1px solid var(--warn)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--warn)' }}>This link opens a web page, not a file</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Copy the direct link to the file instead, usually from the site's Download button.
          </div>
          <button className="btn" onClick={() => void add(p, { force: true })} style={{ alignSelf: 'flex-start', height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500 }}>
            Download anyway
          </button>
        </div>
      )}

      {showTorrentFiles && p && (
        <div style={{ border: '1px solid var(--line)', background: 'var(--panel2)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' }}>{p.filename}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {[
              `${p.files!.length} file${p.files!.length === 1 ? '' : 's'}`,
              formatBytes(p.size),
              p.peers ? `metadata from ${p.peers} peers` : ''
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <div className="scroll" style={{ maxHeight: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {p.files!.map((f) => (
              <label key={f.index} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.has(f.index)}
                  onChange={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(f.index)) n.delete(f.index);
                      else n.add(f.index);
                      return n;
                    })
                  }
                  style={{ accentColor: 'var(--accent)', width: 15, height: 15, margin: 0 }}
                />
                <span title={f.name} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span className="muted">{formatBytes(f.size)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {existsPrompt && p && (
        <div style={{ border: '1px solid var(--warn)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--warn)' }}>The file already exists</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {existsPrompt}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => void add(p, { force: true, overwrite: false })} style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600 }}>
              Keep both
            </button>
            <button className="btn" onClick={() => void add(p, { force: true, overwrite: true })} style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500 }}>
              Replace
            </button>
            <button className="btn" onClick={() => setExistsPrompt(null)} style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500 }}>
              Skip
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="dl-dir" className="label">
          Save to
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="dl-dir" className="input" value={folder} onChange={(e) => setFolder(e.target.value)} style={{ fontSize: 12 }} />
          <button className="btn" aria-label="Browse for folder" onClick={() => void browse()} style={{ width: 40, flex: 'none' }}>
            <Folder size={16} />
          </button>
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={() => void runProbe(link, true)}
        disabled={probing || adding}
        style={{ height: 44, fontSize: 14 }}
      >
        <Plus size={16} />
        {adding ? 'Adding…' : 'Add to queue'}
      </button>
    </div>
  );
}
