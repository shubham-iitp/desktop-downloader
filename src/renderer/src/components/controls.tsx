import { useCallback, useState } from 'react';
import { Check, Chevron } from '../icons';
import { useDismiss } from '../hooks';

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Dropdown<T extends string>({
  labelId,
  value,
  options,
  onChange,
  fontPreview
}: {
  labelId: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  fontPreview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const current = options.find(([v]) => v === value) ?? options[0];
  const fam = (f: string) => (fontPreview ? { fontFamily: `'${f}'`, fontSize: 14 } : undefined);
  return (
    <div ref={ref} style={{ position: 'relative', zIndex: open ? 10 : undefined }}>
      <button aria-haspopup="listbox" aria-expanded={open} aria-labelledby={labelId} className="dd-trigger" onClick={() => setOpen((o) => !o)}>
        <span style={fam(current[0])}>{current[1]}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div role="listbox" aria-labelledby={labelId} className="dd-list">
          {options.map(([v, label]) => (
            <button
              key={v}
              role="option"
              aria-selected={v === value}
              className="dd-option"
              style={fam(v)}
              onClick={() => {
                onChange(v);
                close();
              }}
            >
              <span style={{ display: 'inline-flex', width: 14, color: 'var(--accent)', visibility: v === value ? 'visible' : 'hidden' }}>
                <Check />
              </span>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  decLabel,
  incLabel
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <div className="stepper">
      <button aria-label={decLabel} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} style={{ width: 32, height: 32 }}>
        −
      </button>
      <span style={{ minWidth: 40, fontWeight: 700, fontSize: 14 }}>{value}</span>
      <button aria-label={incLabel} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} style={{ width: 32, height: 32 }}>
        +
      </button>
    </div>
  );
}

// Slider scale from the design: [1 KB/s] gap | 1–100 MB/s in 1 MB steps | gap [Unlimited]
const LO = 0;
const MB1 = 8;
const MB100 = 107;
const M = 114;

/** Download / upload limit: slider, ticks and quick-pick chips. Value in KB/s, -1 = unlimited. */
export function SpeedSlider({ id, title, hint, value, onChange }: { id: string; title: string; hint: string; value: number; onChange: (v: number) => void }) {
  const unl = value < 0;
  const kbMode = !unl && value < 1000;
  const mb = unl || kbMode ? 0 : Math.max(1, Math.min(100, Math.round(value / 1000)));
  const idx = unl ? M : kbMode ? LO : mb + MB1 - 1;
  const pos = (i: number) => i / M;
  const at = (p: number) => `calc(10px + (100% - 20px) * ${p.toFixed(4)})`;
  const zone = {
    position: 'absolute' as const,
    top: 7,
    height: 10,
    borderRadius: 5,
    border: '1px dashed var(--muted)',
    boxSizing: 'border-box' as const,
    background: 'var(--panel)'
  };
  const ticks: [number, string, number | 'kb' | 'inf'][] = [
    [LO, '1 KB', 'kb'],
    [MB1, '1 MB', 1],
    [MB1 + 24, '25', 25],
    [MB1 + 49, '50', 50],
    [MB1 + 74, '75', 75],
    [MB100, '100 MB', 100],
    [M, '∞', 'inf']
  ];
  const presets: [number, string][] = [
    [1, '1 KB/s'],
    [5000, '5 MB/s'],
    [10000, '10 MB/s'],
    [25000, '25 MB/s'],
    [50000, '50 MB/s'],
    [100000, '100 MB/s'],
    [-1, 'Unlimited']
  ];
  const fromIndex = (i: number) => (i <= 3 ? 1 : i < MB1 ? 1000 : i <= MB100 ? (i - MB1 + 1) * 1000 : i <= MB100 + 3 ? 100000 : -1);

  return (
    <div className="st-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14, padding: '18px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <label htmlFor={id} className="st-t">
            {title}
          </label>
          <div className="st-h">{hint}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: unl ? 'var(--text)' : 'var(--accent)' }}>{unl ? '∞' : kbMode ? '1' : mb}</span>
          <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
            {unl ? 'Unlimited' : kbMode ? 'KB/s' : 'MB/s'}
          </span>
        </div>
      </div>
      <div style={{ position: 'relative', height: 24 }}>
        <div aria-hidden style={{ position: 'absolute', left: 10, right: 10, top: 9, height: 6, borderRadius: 3, background: 'var(--line)' }} />
        <div aria-hidden style={{ ...zone, left: at(pos(MB100 + 3.5)), right: 4 }} />
        <div aria-hidden style={{ ...zone, left: 4, width: `calc((100% - 20px) * ${pos(MB1 - 4.5).toFixed(4)} + 6px)` }} />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 10,
            top: 9,
            height: 6,
            borderRadius: 3,
            pointerEvents: 'none',
            background: 'var(--accent)',
            width: `calc((100% - 20px) * ${pos(idx).toFixed(4)})`
          }}
        />
        <input
          id={id}
          className="st-range"
          type="range"
          min={0}
          max={M}
          step={1}
          value={idx}
          aria-valuetext={unl ? 'Unlimited' : kbMode ? '1 KB/s' : `${mb} MB/s`}
          onChange={(e) => onChange(fromIndex(Number(e.target.value)))}
        />
      </div>
      <div aria-hidden style={{ position: 'relative', height: 26, margin: '-6px 10px 0' }}>
        {ticks.map(([ti, label, t]) => {
          const active = unl || (t === 'kb' ? true : t === 'inf' ? false : !kbMode && mb >= t);
          const edge = ti === LO ? 'left' : ti === M ? 'right' : 'mid';
          return (
            <div
              key={label}
              style={{
                position: 'absolute',
                top: 0,
                left: `${(pos(ti) * 100).toFixed(2)}%`,
                transform: `translateX(${edge === 'left' ? '0' : edge === 'right' ? '-100%' : '-50%'})`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: edge === 'left' ? 'flex-start' : edge === 'right' ? 'flex-end' : 'center',
                gap: 3,
                whiteSpace: 'nowrap'
              }}
            >
              <span style={{ width: 1, height: 6, background: 'var(--muted)', opacity: 0.6 }} />
              <span style={{ fontSize: t === 'inf' ? 15 : 11, lineHeight: 1, fontWeight: active ? 600 : 500, color: active ? 'var(--text)' : 'var(--muted)' }}>{label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 12, marginRight: 4 }}>
          Quick pick
        </span>
        {presets.map(([t, label]) => {
          const on = t < 0 ? unl : t === 1 ? kbMode : !unl && !kbMode && mb * 1000 === t;
          return (
            <button key={label} className="chip" aria-pressed={on} onClick={() => onChange(t)}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
