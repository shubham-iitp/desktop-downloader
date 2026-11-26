import { net } from 'electron';
import type { ProbeResult } from '@shared/types';
import { filenameFromUrl, interpretResponse, sanitizeFilename } from './probeParse';

const TIMEOUT_MS = 5000;

function headerObject(lines: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function request(url: string, method: 'HEAD' | 'GET', headers: Record<string, string>) {
  const res = await net.fetch(url, {
    method,
    redirect: 'follow',
    headers: method === 'GET' ? { ...headers, Range: 'bytes=0-0' } : headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Uses Chromium's network stack: system proxy and certificate store apply.
    bypassCustomProtocolHandlers: true
  });
  if (method === 'GET') res.body?.cancel().catch(() => {});
  return res;
}

/**
 * HTTP(S) check: HEAD with a 5 s timeout; on 405 or an error, a GET for the first byte.
 * A failed or timed-out check never blocks adding the link.
 */
export async function probeHttp(url: string, headerLines?: string[]): Promise<ProbeResult> {
  const headers = headerObject(headerLines);
  let res: Response | undefined;
  try {
    res = await request(url, 'HEAD', headers);
    if (res.status === 405 || res.status === 501) res = undefined;
  } catch {
    res = undefined;
  }
  if (!res) {
    try {
      res = await request(url, 'GET', headers);
    } catch {
      return timeoutResult(url);
    }
  }
  return interpretResponse(url, { status: res.status, finalUrl: res.url, headers: res.headers });
}

function timeoutResult(url: string): ProbeResult {
  let host: string | undefined;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  return {
    kind: 'file',
    url,
    filename: sanitizeFilename(filenameFromUrl(url) || host || 'download'),
    host,
    resumable: false,
    size: null,
    error: {
      code: 'PROBE_FAILED',
      message:
        'No response within 5 seconds, so the size and resume support are unknown. You can still add it; aria2c retries 3 times if the connection drops.'
    }
  };
}

/** FTP/SFTP: no header check; size and resume support come from aria2 once the job starts. */
export function probeFtp(url: string): ProbeResult {
  let host: string | undefined;
  let protocol: string | undefined;
  try {
    const u = new URL(url);
    host = u.hostname;
    protocol = u.protocol.replace(':', '').toUpperCase();
  } catch {
    /* ignore */
  }
  return {
    kind: 'file',
    url,
    filename: sanitizeFilename(filenameFromUrl(url) || 'download'),
    host,
    protocol,
    size: null,
    resumable: true
  };
}
