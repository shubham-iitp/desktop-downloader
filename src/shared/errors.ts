import type { ErrorCode } from './types';

/** Maps an aria2 errorCode (see aria2c(1) "EXIT STATUS") to the app's error codes. */
export function mapAria2Error(code: number | string | undefined): ErrorCode {
  switch (Number(code)) {
    case 3:
    case 22:
      return 'HTTP_ERROR';
    case 24:
      return 'AUTH_REQUIRED';
    case 9:
    case 16:
    case 17:
    case 18:
      return 'DISK_ERROR';
    case 2:
    case 6:
    case 19:
      return 'NETWORK';
    case 8:
      return 'NO_RESUME';
    case 32:
      return 'CHECKSUM_FAILED';
    case 13:
      return 'FILE_EXISTS';
    default:
      return 'UNKNOWN';
  }
}

/** Codes the JobManager retries on its own before reporting a failure. */
export const AUTO_RETRY_CODES: ReadonlySet<ErrorCode> = new Set(['NETWORK']);
/** Backoff for automatic retries: 5 s, 30 s, 2 min. */
export const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000] as const;

export function friendlyError(code: ErrorCode, raw?: string): string {
  switch (code) {
    case 'HTTP_ERROR':
      return raw ? `Server error · ${raw}` : 'The server returned an error';
    case 'AUTH_REQUIRED':
      return 'Sign-in required · add headers or cookies, then retry';
    case 'DISK_ERROR':
      return 'Could not write to disk · check free space or pick another folder';
    case 'NETWORK':
      return 'Network error · retried 3 times';
    case 'NO_RESUME':
      return 'The server does not support resuming · a retry restarts from 0';
    case 'CHECKSUM_FAILED':
      return 'Checksum failed · the file is corrupt, redownload it';
    case 'ENGINE_CRASH':
      return 'The download engine stopped';
    case 'FILE_EXISTS':
      return 'A file with this name already exists';
    case 'LINK_EXPIRED':
      return 'Link expired, fetch again';
    case 'FORMAT_UNAVAILABLE':
      return 'That quality isn’t available any more · fetch the page again';
    case 'MERGE_FAILED':
      return 'Couldn’t merge video and audio with ffmpeg · retry';
    case 'EXTRACTOR':
      return raw ? `yt-dlp couldn’t download this · ${raw}` : 'yt-dlp couldn’t download this';
    default:
      return raw || 'Download failed';
  }
}
