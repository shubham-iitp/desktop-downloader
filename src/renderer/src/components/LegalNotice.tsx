import { useState } from 'react';

const KEY = 'legalNoticeAck';

/** First-run notice: the user is responsible for what they download. */
export function LegalNotice() {
  const [ack, setAck] = useState(() => localStorage.getItem(KEY) === '1');
  if (ack) return null;
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        fontSize: 13,
        lineHeight: 1.5
      }}
    >
      <span style={{ flex: 1 }}>
        Downloader is a general-purpose downloader and torrent client. You’re responsible for following copyright law and each site’s
        terms for what you download.
      </span>
      <button
        className="btn"
        style={{ height: 32, padding: '0 12px', fontSize: 13, fontWeight: 600 }}
        onClick={() => {
          localStorage.setItem(KEY, '1');
          setAck(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
