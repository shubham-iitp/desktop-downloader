import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CaptureItem, CaptureUpdate, Settings } from '@shared/types';
import { Check, Chevron, NoVideo, PlayFilled, WinClose } from '../icons';
import { useDismiss } from '../hooks';

interface Props {
  capture: CaptureUpdate;
  settings: Settings;
  onClose: () => void;
  /** "Fetch again" on the empty state: back to the Videos panel with this page. */
  onFetchAgain: (url: string) => void;
  /** After Add N to queue. */
  onAdded: () => void;
}

interface RowState {
  on: boolean;
  lines: string[];
  /** Quality keys already queued (rows are marked "Added"). */
  added: string[];
}

const HUES = ['#3A4D6B', '#5A3B5E', '#2F5A4A', '#6B4A2F', '#4A4F5C', '#5C3A3A'];

function hueOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function duration(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Captured HLS / DASH streams start unticked (often long and large); everything else ticked. */
const initialRow = (it: CaptureItem): RowState => ({ on: it.type !== 'hls' && it.type !== 'dash', lines: [it.defaultQuality], added: [] });

/**
 * "Videos found": opens the moment the capture session ends and fills in while scans run.
 * Each ticked row at each picked quality becomes one queue job. Closing discards anything not added.
 */
export function VideosPopup({ capture, settings, onClose, onFetchAgain, onAdded }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [openQ, setOpenQ] = useState('');
  const [folder, setFolder] = useState(settings.dirVideos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const closeQ = useCallback(() => setOpenQ(''), []);

  // New rows arrive while scanning; keep the user's choices for the ones already shown.
  useEffect(() => {
    setRows((prev) => {
      const next = { ...prev };
      for (const it of capture.items) if (!next[it.id]) next[it.id] = initialRow(it);
      return next;
    });
  }, [capture.items]);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openQ) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, openQ]);

  const scanning = capture.phase === 'scanning';
  const items = capture.items;
  const st = (id: string) => rows[id] ?? initialRow(items.find((i) => i.id === id)!);
  const pending = useMemo(
    () => items.flatMap((it) => (st(it.id).on ? st(it.id).lines.filter((q) => !st(it.id).added.includes(q)).map((q) => [it.id, q] as const) : [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, rows]
  );
  const count = pending.length;
  const set = (id: string, fn: (r: RowState) => Partial<RowState>) => setRows((p) => ({ ...p, [id]: { ...st(id), ...fn(p[id] ?? st(id)) } }));

  const add = async () => {
    if (!count) return;
    setBusy(true);
    setError('');
    const failures: string[] = [];
    for (const [itemId, quality] of pending) {
      // `url` is ignored for video jobs: the main process looks the row up in its own session.
      const r = await window.dl.add({ kind: 'media', url: 'capture', dir: folder, media: { sessionId: capture.sessionId, itemId, quality } });
      if (r.ok) set(itemId, (x) => ({ added: [...x.added, quality] }));
      else failures.push(r.error.message);
    }
    setBusy(false);
    if (failures.length < pending.length) onAdded();
    if (failures.length) setError(failures[0]);
    else onClose(); // everything queued: done with this list
  };

  const pick = async () => {
    const d = await window.dl.pickFolder(folder);
    if (d) setFolder(d);
  };

  const pages = capture.progress.total;
  return (
    <div className="overlay" style={{ padding: 32, boxSizing: 'border-box' }}>
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pop-title"
        className="dialog"
        style={{ width: 880, maxWidth: '100%', maxHeight: '100%', padding: 0, gap: 0, overflow: 'hidden', outline: 'none' }}
      >
        <div style={{ padding: '20px 22px 14px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 id="pop-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Videos found
              </h2>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                From {pages} page{pages === 1 ? '' : 's'} you visited in {capture.browserName}
              </div>
            </div>
            <button aria-label="Close and discard anything not added" title="Close" onClick={onClose} className="x-btn">
              <WinClose w={1.4} />
            </button>
          </div>
          {scanning && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div role="status" style={{ fontSize: 12, fontWeight: 600, color: 'var(--run)' }}>
                Scanning {capture.progress.done} of {pages} page{pages === 1 ? '' : 's'}…
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--track)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, background: 'var(--run)', width: `${Math.round((capture.progress.done / Math.max(1, pages)) * 100)}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}
        </div>

        <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 22px' }}>
          {!scanning && items.length === 0 && (
            <div style={{ padding: '56px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
              <span className="muted">
                <NoVideo />
              </span>
              <div style={{ fontSize: 16, fontWeight: 700 }}>No downloadable videos found on this page</div>
              <button className="btn" onClick={() => onFetchAgain(capture.url)} style={{ marginTop: 6, height: 38, padding: '0 16px', borderRadius: 10, fontWeight: 600 }}>
                Fetch again
              </button>
            </div>
          )}
          {items.map((it) => (
            <Row key={it.id} it={it} st={st(it.id)} set={(fn) => set(it.id, fn)} openQ={openQ} setOpenQ={setOpenQ} closeQ={closeQ} />
          ))}
          {scanning && (
            <div aria-hidden style={{ display: 'flex', gap: 14, padding: '14px 0', alignItems: 'center', opacity: 0.6 }}>
              <div style={{ width: 18 }} />
              <div style={{ width: 128, height: 72, borderRadius: 8, background: 'var(--track)' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ height: 12, width: '55%', borderRadius: 6, background: 'var(--track)' }} />
                <div style={{ height: 10, width: '30%', borderRadius: 5, background: 'var(--track)' }} />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--panel2)' }}>
          {error && <div style={{ fontSize: 12, color: 'var(--err)' }}>{error}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label htmlFor="pop-dir" className="label">
              Save to
            </label>
            <input id="pop-dir" className="input" value={folder} onChange={(e) => setFolder(e.target.value)} style={{ flex: 1, minWidth: 200, height: 38, padding: '0 10px', fontSize: 12 }} />
            <button className="btn" onClick={() => void pick()} style={{ height: 38, padding: '0 12px', fontSize: 13 }}>
              Change…
            </button>
            <button
              className="btn-primary"
              onClick={() => void add()}
              disabled={!count || busy}
              style={{ height: 38, padding: '0 18px', ...(count && !busy ? {} : { background: 'var(--line)', color: 'var(--muted)', cursor: 'not-allowed' }) }}
            >
              {count ? `Add ${count} to queue` : 'Add to queue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  it,
  st,
  set,
  openQ,
  setOpenQ,
  closeQ
}: {
  it: CaptureItem;
  st: RowState;
  set: (fn: (r: RowState) => Partial<RowState>) => void;
  openQ: string;
  setOpenQ: (k: string) => void;
  closeQ: () => void;
}) {
  const multi = it.qualities.length > 1;
  const allAdded = st.lines.every((q) => st.added.includes(q));
  const added = st.added.length > 0 && allAdded;
  const q = (k: string) => it.qualities.find((o) => o.key === k) ?? it.qualities[0];
  const label = (k: string) => [q(k).label, q(k).size].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', gap: 14, padding: '14px 0', borderBottom: '1px solid var(--line)', alignItems: 'flex-start' }}>
      <div style={{ paddingTop: 22, width: 18 }}>
        {added ? (
          <span style={{ color: 'var(--ok)' }} aria-label="Added">
            <Check size={18} />
          </span>
        ) : (
          <input
            type="checkbox"
            checked={st.on}
            onChange={() => set((r) => ({ on: !r.on }))}
            aria-label={`Select ${it.title}`}
            style={{ accentColor: 'var(--accent)', width: 18, height: 18, margin: 0, cursor: 'pointer' }}
          />
        )}
      </div>
      <div
        style={{
          flex: 'none',
          position: 'relative',
          width: 128,
          height: 72,
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: hueOf(it.id)
        }}
      >
        {it.thumbnail ? <img src={it.thumbnail} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <PlayFilled />}
        {duration(it.duration) && (
          <span style={{ position: 'absolute', right: 6, bottom: 6, fontSize: 11, fontWeight: 600, color: '#FFFFFF', background: 'rgba(0,0,0,0.7)', padding: '1px 5px', borderRadius: 4 }}>
            {duration(it.duration)}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span title={it.title} style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {it.title}
          </span>
          {st.added.length > 0 && (
            <span style={{ flex: 'none', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--ok)', color: 'var(--ok)' }}>Added</span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {it.source}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {st.lines.map((k, li) => {
            const key = `${it.id}:${li}`;
            const isAdded = st.added.includes(k);
            return (
              <QualityLine
                key={key}
                open={openQ === key}
                toggle={() => setOpenQ(openQ === key ? '' : key)}
                close={closeQ}
                multi={multi}
                disabled={isAdded}
                label={label(k)}
                removable={st.lines.length > 1 && !isAdded}
                remove={() => set((r) => ({ lines: r.lines.filter((_, j) => j !== li) }))}
                options={it.qualities.map((o) => ({
                  key: o.key,
                  name: o.label + (o.key !== k && st.lines.includes(o.key) ? ' (added above)' : ''),
                  size: o.size,
                  on: o.key === k,
                  taken: o.key !== k && st.lines.includes(o.key)
                }))}
                pick={(nk) => {
                  set((r) => ({ lines: r.lines.map((z, j) => (j === li ? nk : z)), on: true }));
                  closeQ();
                }}
              />
            );
          })}
          {multi && st.lines.length < it.qualities.length && (
            <button
              onClick={() =>
                set((r) => {
                  const next = it.qualities.find((o) => !r.lines.includes(o.key));
                  return next ? { lines: [...r.lines, next.key], on: true } : {};
                })
              }
              style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: '2px 0', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              + Add another quality
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QualityLine(p: {
  open: boolean;
  toggle: () => void;
  close: () => void;
  multi: boolean;
  disabled: boolean;
  label: string;
  removable: boolean;
  remove: () => void;
  options: { key: string; name: string; size: string; on: boolean; taken: boolean }[];
  pick: (k: string) => void;
}) {
  const ref = useDismiss<HTMLDivElement>(p.open, p.close);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  // The menu floats above the popup (position: fixed), so the scrolling list can't cut it off:
  // below the button when the window has room, else above it.
  const toggle = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const need = p.options.length * 37 + 12;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const down = below >= need || below >= above;
      setPos({
        position: 'fixed',
        left: r.left,
        minWidth: Math.max(280, r.width),
        maxHeight: Math.max(120, down ? below : above),
        overflowY: 'auto',
        ...(down ? { top: r.bottom + 4, bottom: 'auto' } : { bottom: window.innerHeight - r.top + 4, top: 'auto' })
      });
    }
    p.toggle();
  };
  // Scrolling the list would leave a fixed menu behind: close it.
  useEffect(() => {
    if (!p.open) return;
    const sc = ref.current?.closest('.scroll');
    const onScroll = () => p.close();
    sc?.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onScroll);
    return () => {
      sc?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [p.open, p.close, ref]);
  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
      <button
        aria-haspopup="listbox"
        aria-expanded={p.open}
        aria-label="Quality"
        ref={btn}
        onClick={toggle}
        disabled={p.disabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minWidth: 260,
          height: 36,
          padding: '0 12px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          cursor: p.disabled ? 'default' : 'pointer',
          color: 'var(--text)',
          background: 'var(--panel2)',
          border: `1px solid ${p.open ? 'var(--accent)' : 'var(--line)'}`,
          opacity: p.disabled ? 0.7 : 1
        }}
      >
        <span>{p.label}</span>
        <Chevron open={p.open} />
      </button>
      {p.removable && (
        <button aria-label="Remove this quality" onClick={p.remove} className="x-btn" style={{ width: 28, height: 28, margin: 0 }}>
          <WinClose w={1.4} />
        </button>
      )}
      {p.open && (
        <div role="listbox" aria-label="Quality" className="dd-list" style={{ right: 'auto', zIndex: 60, ...pos }}>
          {p.options.map((o) => (
            <button
              key={o.key}
              role="option"
              aria-selected={o.on}
              className="dd-option"
              onClick={() => p.pick(o.key)}
              style={{ fontWeight: o.on ? 600 : 500, background: o.on ? 'var(--panel2)' : undefined, opacity: o.taken ? 0.5 : 1 }}
            >
              <span style={{ display: 'inline-flex', width: 14, color: 'var(--accent)', visibility: o.on ? 'visible' : 'hidden' }}>
                <Check />
              </span>
              <span style={{ flex: 1 }}>{o.name}</span>
              <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {o.size}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
