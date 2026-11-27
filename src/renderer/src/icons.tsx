import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, extra: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...extra
});

export const Logo = ({ size = 18, ...p }: P) => (
  <svg {...base(size, p)} stroke="var(--accent)" strokeWidth={2.2}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);
export const DownloadGlyph = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.2}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);
export const Gear = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const Magnet = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M6 3v8a6 6 0 0 0 12 0V3" />
    <path d="M6 7h4M14 7h4" />
  </svg>
);
export const LinkIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1" />
    <path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />
  </svg>
);
export const Minus = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.4}>
    <path d="M5 12h14" />
  </svg>
);
export const Plus = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.4}>
    <path d="M5 12h14M12 5v14" />
  </svg>
);
export const Trash = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M9 7V4h6v3" />
  </svg>
);
export const Folder = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const Retry = ({ size = 13, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.2}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </svg>
);
export const Play = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor" stroke="none">
    <path d="M7 4v16l13-8z" />
  </svg>
);
export const PauseIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor" stroke="none">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);
export const Close = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const Clipboard = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
  </svg>
);
export const Search = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </svg>
);
export const FileIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </svg>
);
export const ChevronLeft = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.2}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const Chevron = ({ open, size = 12 }: { open: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
  </svg>
);
export const Check = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={2.6}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
export const Wrench = ({ size = 24, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-.7-.7-2.8z" />
  </svg>
);
export const External = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);
export const WinMin = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M0 5h10" stroke="currentColor" />
  </svg>
);
export const WinMax = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
  </svg>
);
export const WinClose = ({ w = 1 }: { w?: number }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M0 0l10 10M10 0 0 10" stroke="currentColor" strokeWidth={w} />
  </svg>
);
/** Screen with a play triangle: the Videos tab and Fetch videos. */
export const VideoIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m10 9 5 3-5 3z" fill="currentColor" />
  </svg>
);
export const PlayFilled = ({ size = 22, ...p }: P) => (
  <svg {...base(size, p)} stroke="none" fill="rgba(255,255,255,0.9)">
    <path d="M8 5v14l11-7z" />
  </svg>
);
export const NoVideo = ({ size = 36, ...p }: P) => (
  <svg {...base(size, p)} strokeWidth={1.6}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M3 3l18 18" />
  </svg>
);
