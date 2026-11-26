import type { ProbeResult } from '@shared/types';

/* Pure helpers for job:probe. No Electron imports, so they run under Vitest. */

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Strips path separators, control and reserved characters, and reserved Windows names. */
export function sanitizeFilename(name: string): string {
  let n = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  if (n === '.' || n === '..') n = '';
  if (RESERVED.test(n)) n = `_${n}`;
  return n.slice(0, 240);
}

/** Filename from a Content-Disposition header (RFC 6266, incl. filename*=UTF-8''...). */
export function filenameFromDisposition(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (plain) return (plain[2] ?? plain[1]).trim();
  return undefined;
}

export function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

export function isAttachment(disposition: string | null | undefined): boolean {
  return !!disposition && /^\s*attachment/i.test(disposition);
}

export type LinkRoute = 'torrent' | 'metalink' | 'ftp' | 'http' | 'invalid';

/** Decides how job:probe handles a link before any network request. */
export function routeLink(url: string): LinkRoute {
  const lower = url.trim().toLowerCase();
  if (lower.startsWith('magnet:')) return 'torrent';
  const pathPart = lower.split(/[?#]/)[0];
  const isLocal = !/^[a-z][a-z0-9+.-]*:\/\//.test(lower) || lower.startsWith('file://');
  if (pathPart.endsWith('.torrent')) return 'torrent';
  if (pathPart.endsWith('.metalink') || pathPart.endsWith('.meta4')) return 'metalink';
  if (isLocal) return 'invalid';
  if (lower.startsWith('ftp://') || lower.startsWith('sftp://')) return 'ftp';
  if (lower.startsWith('http://') || lower.startsWith('https://')) return 'http';
  return 'invalid';
}

export interface ProbeResponse {
  status: number;
  finalUrl: string;
  headers: { get(name: string): string | null };
}

/** Turns the HEAD (or ranged GET) response into a ProbeResult, per the tech doc's rules. */
export function interpretResponse(url: string, res: ProbeResponse): ProbeResult {
  const finalUrl = res.finalUrl || url;
  let host: string | undefined;
  let protocol: string | undefined;
  try {
    const u = new URL(finalUrl);
    host = u.hostname.replace(/^www\./, '');
    protocol = u.protocol.replace(':', '').toUpperCase();
  } catch {
    /* ignore */
  }
  const disposition = res.headers.get('content-disposition');
  const name = sanitizeFilename(filenameFromDisposition(disposition) || filenameFromUrl(finalUrl) || host || 'download');
  const base: ProbeResult = { kind: 'file', url, finalUrl, filename: name, host, protocol, resumable: false, size: null };

  if (res.status === 401 || res.status === 403) {
    return {
      ...base,
      error: {
        code: 'AUTH_REQUIRED',
        status: res.status,
        message: 'This file needs credentials. Add a cookie or Authorization header from your browser, then check again. Headers are stored encrypted.'
      }
    };
  }
  if (res.status >= 400) {
    return {
      ...base,
      error: {
        code: 'HTTP_ERROR',
        status: res.status,
        message:
          res.status === 404
            ? 'The server says there is nothing at this address. Check the link for typos, or ask whoever shared it for a fresh one.'
            : `The server answered with HTTP ${res.status}. Try again later, or check the link.`
      }
    };
  }

  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('text/html') && !isAttachment(disposition)) {
    return {
      ...base,
      error: { code: 'NOT_A_FILE', message: 'This link opens a web page, not a file.' }
    };
  }

  let size: number | null = null;
  const range = res.headers.get('content-range');
  if (res.status === 206 && range) {
    const m = /\/(\d+)\s*$/.exec(range);
    if (m) size = Number(m[1]);
  } else {
    const len = res.headers.get('content-length');
    if (len && /^\d+$/.test(len.trim())) size = Number(len);
  }
  const resumable = res.status === 206 || (res.headers.get('accept-ranges') || '').toLowerCase().includes('bytes');

  const kind = /\.(meta4|metalink)$/i.test(name) || type.includes('metalink') ? 'metalink' : 'file';
  return { ...base, kind, size, resumable };
}
