import { useState } from 'react';
import type { EngineStatus } from '@shared/types';
import { Check, External, Retry, Wrench } from '../icons';
import { TitleBar } from './TitleBar';

const RELEASES = 'https://github.com/shubham-iitp/desktop-downloader/releases';

interface Props {
  engine: EngineStatus | null;
  state: 'broken' | 'fixed' | 'none';
  isMac: boolean;
  platform: string;
  onBack: () => void;
}

/** Shown when aria2c is missing/blocked or keeps crashing. */
export function RepairView({ engine, state, isMac, platform, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const win = platform === 'win32';
  const crashed = engine?.state === 'crashed';
  const fixed = state === 'fixed';
  const bin = win ? 'aria2c.exe' : 'aria2c';
  const path = engine?.binPath ?? bin;
  const err = engine?.error ?? (crashed ? 'Engine exited unexpectedly' : 'File not found');
  const cause = crashed
    ? 'Often a full disk, or another program holding the download folder. aria2.log has the exact reason.'
    : win
      ? 'Windows Security sometimes quarantines download tools by mistake.'
      : isMac
        ? 'Files inside the app were changed or removed, which breaks its signature.'
        : 'Files inside the app were changed or removed.';
  const steps = crashed
    ? [
        'Check there is free space on the drive you download to.',
        'Click Restart engine. Downloads resume from where they stopped.',
        'If it stops again, click Copy details and include it in a bug report.'
      ]
    : win
      ? [
          'Open Windows Security › Virus & threat protection › Protection history.',
          `Find the entry for ${bin}, choose Actions › Restore, then click Restart engine.`,
          'To stop it happening again, add the Downloader folder under Exclusions.'
        ]
      : [
          'Download Downloader again and replace the old copy.',
          isMac ? 'Open it once from Applications so macOS checks the new copy.' : 'Start it once so the engine is checked.',
          'Your queue and settings are kept; they live outside the app.'
        ];
  const openLabel = crashed ? 'Open aria2.log' : win ? 'Open Windows Security' : 'Open download page';
  const open = () => {
    if (crashed) void window.dl.openLog();
    else if (win) void window.dl.openExternal('windowsdefender:');
    else void window.dl.openExternal(RELEASES);
  };
  const copy = async () => {
    const tail = await window.dl.logTail().catch(() => '');
    void navigator.clipboard.writeText(`ENGINE ${crashed ? 'CRASH' : 'MISSING'}\n${path}\n${err}\n\n${tail}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const restart = async () => {
    setBusy(true);
    try {
      await window.dl.restartEngine();
    } finally {
      setBusy(false);
    }
  };
  const tone = fixed ? 'var(--ok)' : 'var(--warn)';

  return (
    <>
      <TitleBar isMac={isMac} title="Downloader" />
      <div className="scroll" style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            <div
              style={{
                flex: 'none',
                width: 52,
                height: 52,
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${tone}`,
                color: tone
              }}
            >
              {fixed ? <Check size={24} /> : <Wrench />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>
                {fixed ? 'The download engine is running again' : crashed ? 'The download engine keeps stopping' : 'The download engine is missing or blocked'}
              </h1>
              <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
                {fixed
                  ? `aria2c ${engine?.version ?? ''} started normally. Downloads pick up where they left off.`
                  : `Downloader uses aria2c, which ships inside the app, for every download. ${crashed ? 'It stopped twice in a row' : 'It couldn’t be started'}, so all downloads are paused. Nothing in your queue is lost.`}
              </p>
            </div>
          </div>

          {!fixed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 600 }}>What happened</div>
                <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '8px 14px', fontSize: 13 }}>
                  <span className="muted">Expected at</span>
                  <code className="mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>
                    {path}
                  </code>
                  <span className="muted">Error</span>
                  <span>{err}</span>
                  <span className="muted">Likely cause</span>
                  <span style={{ lineHeight: 1.5 }}>{cause}</span>
                </div>
              </div>
              <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 600 }}>{crashed ? 'How to fix it' : win ? 'If Windows Security removed it' : 'Reinstall to fix it'}</div>
                <ol className="muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 13 }}>
                  {steps.map((st) => (
                    <li key={st}>{st}</li>
                  ))}
                </ol>
                <div>
                  <button className="btn" onClick={open} style={{ height: 34, padding: '0 12px', fontSize: 13, fontWeight: 500 }}>
                    <External />
                    {openLabel}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            {fixed ? (
              <span className="muted" style={{ fontSize: 13 }}>
                Your queue was restored from the saved session.
              </span>
            ) : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => void copy()} style={{ height: 44, padding: '0 14px', fontWeight: 500 }}>
                  {copied ? 'Copied' : 'Copy details'}
                </button>
                <button className="btn" onClick={() => void window.dl.openExternal(RELEASES)} style={{ height: 44, padding: '0 14px', fontWeight: 500 }}>
                  Reinstall Downloader…
                </button>
              </div>
            )}
            <button className="btn-primary" disabled={busy} onClick={() => (fixed ? onBack() : void restart())} style={{ height: 44, padding: '0 20px' }}>
              <Retry size={16} />
              {fixed ? 'Back to downloads' : busy ? 'Starting…' : 'Restart engine'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
