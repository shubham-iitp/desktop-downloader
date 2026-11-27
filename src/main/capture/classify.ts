/*
 * Pure helpers for V2 video capture: classifying captured responses, reading HLS / DASH
 * manifests (variants and DRM), quality options, merging with yt-dlp results, and the
 * yt-dlp arguments and output parsing for video jobs. No Electron imports, so it's unit-tested.
 */
import type { ErrorCode, QualityOption } from '@shared/types';

export type MediaType = 'hls' | 'dash' | 'progressive' | 'segment';

/** URL without query string or fragment, for matching captured links against yt-dlp formats. */
export function stripQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

const ext = (url: string) => (stripQuery(url).match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? '').toLowerCase();

export interface CapturedResponse {
  url: string;
  mimeType?: string;
  status?: number;
  /** Full size in bytes: Content-Length, or the total from Content-Range on a 206. */
  size?: number;
}

/** What a captured response is, per the tech doc's table; undefined = ignored. */
export function classifyResponse(r: CapturedResponse): MediaType | undefined {
  if (!/^https?:/i.test(r.url)) return undefined; // blob:, data:, chrome-extension:
  if (r.status && (r.status < 200 || r.status >= 400)) return undefined;
  const mime = (r.mimeType ?? '').toLowerCase().split(';')[0].trim();
  const e = ext(r.url);
  if (e === 'm3u8' || mime === 'application/vnd.apple.mpegurl' || mime === 'application/x-mpegurl' || mime === 'audio/mpegurl') return 'hls';
  if (e === 'mpd' || mime === 'application/dash+xml') return 'dash';
  if (e === 'ts' || e === 'm4s' || mime === 'video/mp2t' || mime === 'video/iso.segment' || /[?&](range|bytes)=\d+-\d+/i.test(r.url)) return 'segment';
  const mediaMime = mime.startsWith('video/') || mime.startsWith('audio/');
  const mediaExt = ['mp4', 'webm', 'm4a', 'mp3', 'm4v', 'mov', 'mkv'].includes(e);
  if ((mediaMime || mediaExt) && (r.size ?? 0) > 1_000_000) return 'progressive';
  return undefined;
}

/** Total size from response headers (Content-Range wins: a 206 covers only part of the file). */
export function sizeFromHeaders(headers: Record<string, string>): number | undefined {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  const total = h['content-range']?.match(/\/(\d+)\s*$/)?.[1];
  if (total) return Number(total);
  const len = Number(h['content-length']);
  return Number.isFinite(len) && len > 0 ? len : undefined;
}

// ---------------------------------------------------------------- HLS

export interface HlsVariant {
  url: string;
  bandwidth?: number;
  width?: number;
  height?: number;
}

export interface HlsInfo {
  master: boolean;
  variants: HlsVariant[];
  drm: boolean;
  /** Media playlists: sum of EXTINF, in seconds. */
  duration?: number;
  /** Media playlists: segment URLs, absolute. */
  segments: string[];
}

const DRM_KEYFORMAT = /(edef8ba9-79d6-4ace-a3c8-27dcd51d21ed|9a04f079-9840-4286-ab92-e65be0885f95|widevine|playready|com\.apple\.streamingkeydelivery|fairplay)/i;

function attrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

/**
 * DRM per the tech doc: SAMPLE-AES encryption, or a Widevine / PlayReady / FairPlay KEYFORMAT.
 * Plain AES-128 is fine (ffmpeg decrypts it).
 */
export function hlsHasDrm(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (!/^#EXT-X-(SESSION-)?KEY:/i.test(line)) continue;
    const a = attrs(line.slice(line.indexOf(':') + 1));
    const method = (a.METHOD ?? '').toUpperCase();
    if (method.startsWith('SAMPLE-AES')) return true;
    if (a.KEYFORMAT && DRM_KEYFORMAT.test(a.KEYFORMAT)) return true;
  }
  return false;
}

export function parseHls(text: string, base: string): HlsInfo {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const variants: HlsVariant[] = [];
  const segments: string[] = [];
  let duration = 0;
  let sawInf = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const a = attrs(l.slice(18));
      const uri = lines.slice(i + 1).find((x) => x && !x.startsWith('#'));
      if (!uri) continue;
      const [w, h] = (a.RESOLUTION ?? '').split('x').map(Number);
      variants.push({
        url: resolve(uri, base),
        bandwidth: Number(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH) || undefined,
        width: w || undefined,
        height: h || undefined
      });
    } else if (l.startsWith('#EXTINF:')) {
      sawInf = true;
      duration += parseFloat(l.slice(8)) || 0;
      const uri = lines.slice(i + 1).find((x) => x && !x.startsWith('#'));
      if (uri) segments.push(resolve(uri, base));
    }
  }
  return { master: variants.length > 0, variants, drm: hlsHasDrm(text), duration: sawInf ? duration : undefined, segments };
}

function resolve(uri: string, base: string): string {
  try {
    return new URL(uri, base).toString();
  } catch {
    return uri;
  }
}

/**
 * A copy of an HLS master playlist that's safe to hand yt-dlp on Windows: every URI made
 * absolute (the copy is read from disk), and track names / group ids reduced to letters,
 * digits, _ and -. yt-dlp names its temporary audio file after them ("….fa2-Original | English.mp4")
 * without removing characters Windows forbids, and the download then fails with WinError 123.
 * Group references in #EXT-X-STREAM-INF are renamed the same way so they still match.
 */
export function safeHlsMaster(text: string, base: string): string {
  const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'track';
  return text
    .split(/\r?\n/)
    .map((l) => {
      const t = l.trim();
      if (!t) return l;
      if (!t.startsWith('#')) return resolve(t, base);
      return t
        .replace(/URI="([^"]+)"/g, (_, u: string) => `URI="${resolve(u, base)}"`)
        .replace(/\b(NAME|GROUP-ID|AUDIO|VIDEO|SUBTITLES|CLOSED-CAPTIONS)="([^"]*)"/g, (_, k: string, v: string) => `${k}="${safe(v)}"`);
    })
    .join('\n');
}

// ---------------------------------------------------------------- DASH

export interface DashRepresentation {
  id: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  kind: 'video' | 'audio' | 'other';
}

export interface DashInfo {
  drm: boolean;
  representations: DashRepresentation[];
  duration?: number;
}

/** ISO 8601 duration (PT1H2M10.5S) in seconds. */
export function isoDuration(s: string | undefined): number | undefined {
  const m = s?.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return undefined;
  const [, d, h, mi, se] = m.map((x) => (x ? parseFloat(x) : 0)) as number[];
  const t = d * 86400 + h * 3600 + mi * 60 + se;
  return t > 0 ? t : undefined;
}

function xmlAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out[m[1]] = m[2];
  return out;
}

export function parseDash(text: string): DashInfo {
  const drm = /<(?:[\w-]+:)?ContentProtection\b/i.test(text);
  const mpd = text.match(/<(?:[\w-]+:)?MPD\b[^>]*>/i)?.[0];
  const duration = isoDuration(mpd ? xmlAttrs(mpd).mediaPresentationDuration : undefined);
  const representations: DashRepresentation[] = [];
  const sets = text.split(/<(?:[\w-]+:)?AdaptationSet\b/i).slice(1);
  for (const set of sets) {
    const head = xmlAttrs(set.slice(0, set.indexOf('>')));
    const setType = `${head.contentType ?? ''} ${head.mimeType ?? ''}`.toLowerCase();
    const re = /<(?:[\w-]+:)?Representation\b([^>]*)>/gi;
    for (let m = re.exec(set); m; m = re.exec(set)) {
      const a = xmlAttrs(m[1]);
      const t = `${setType} ${(a.mimeType ?? '').toLowerCase()}`;
      representations.push({
        id: a.id ?? String(representations.length),
        bandwidth: Number(a.bandwidth) || undefined,
        width: Number(a.width) || undefined,
        height: Number(a.height) || undefined,
        kind: t.includes('video') || a.height ? 'video' : t.includes('audio') ? 'audio' : 'other'
      });
    }
  }
  return { drm, representations, duration };
}

// ---------------------------------------------------------------- sizes and qualities

/** "48 MB", "1.6 GB"; with `approx`, "~210 MB". */
export function formatSize(bytes: number | undefined, approx = false): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const n = v < 10 && i >= 3 ? v.toFixed(1) : String(Math.round(v));
  return `${approx ? '~' : ''}${n} ${units[i]}`;
}

/**
 * The one option of a single-quality stream (an HLS media playlist): its resolution and size
 * when known, e.g. "1080p" / "~1.9 GB", else "Original quality".
 */
export function singleQuality(height: number | undefined, bytes: number | undefined): QualityOption {
  return { key: 'single', label: height ? `${height}p` : 'Original quality', size: formatSize(bytes, true) };
}

/** Variant options for a captured HLS / DASH stream, highest first: "720p · 3.2 Mbps", "~1.5 GB". */
export function streamQualities(variants: { height?: number; bandwidth?: number }[], duration?: number): QualityOption[] {
  const seen = new Set<string>();
  const sorted = [...variants].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
  const out: QualityOption[] = [];
  for (const v of sorted) {
    const key = v.height ? String(v.height) : v.bandwidth ? `b${v.bandwidth}` : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const mbps = v.bandwidth ? `${(v.bandwidth / 1e6).toFixed(1)} Mbps` : '';
    out.push({
      key,
      label: [v.height ? `${v.height}p` : 'Stream', mbps].filter(Boolean).join(' · '),
      size: v.bandwidth && duration ? formatSize((v.bandwidth / 8) * duration, true) : ''
    });
  }
  return out.length ? out : [{ key: 'best', label: 'Best available', size: '' }];
}

/** The subset of yt-dlp's format dict we use. */
export interface YtFormat {
  format_id?: string;
  url?: string;
  manifest_url?: string;
  height?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
  has_drm?: boolean | string | null;
}

export interface YtInfo {
  id?: string;
  title?: string;
  duration?: number | null;
  webpage_url?: string;
  original_url?: string;
  extractor_key?: string;
  thumbnail?: string | null;
  formats?: YtFormat[];
  // Single-format results (no `formats` list) carry these at the top level.
  url?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
  height?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  _type?: string;
  entries?: (YtInfo | null)[];
}

const HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

const hasVideo = (f: YtFormat) => !!f.vcodec && f.vcodec !== 'none';
const hasAudio = (f: YtFormat) => !!f.acodec && f.acodec !== 'none';
const isDrm = (f: YtFormat) => f.has_drm === true || f.has_drm === 'maybe';

/** filesize, else filesize_approx, else bitrate × duration (approximate). */
function fmtBytes(f: YtFormat | undefined, duration?: number | null): { bytes?: number; approx: boolean } {
  if (!f) return { approx: true };
  if (f.filesize) return { bytes: f.filesize, approx: false };
  if (f.filesize_approx) return { bytes: f.filesize_approx, approx: true };
  if (f.tbr && duration) return { bytes: (f.tbr * 1000 * duration) / 8, approx: true };
  return { approx: true };
}

/** Formats yt-dlp can actually download: DRM ones removed (tech doc: never shown). */
export function clearFormats(info: YtInfo): YtFormat[] {
  const list = info.formats?.length ? info.formats : info.url ? [info as YtFormat] : [];
  return list.filter((f) => !isDrm(f));
}

/**
 * Popup options for a yt-dlp entry: Best, each available height, Audio only (M4A), Audio only (MP3).
 * Empty = nothing downloadable (all formats DRM).
 */
export function ytdlpQualities(info: YtInfo): QualityOption[] {
  const fmts = clearFormats(info);
  if (!fmts.length) return [];
  const dur = info.duration ?? undefined;
  // Unknown codecs (generic extractor) count as audio+video.
  const video = fmts.filter((f) => hasVideo(f) || (f.vcodec == null && f.height));
  const audioOnly = fmts.filter((f) => hasAudio(f) && !hasVideo(f));
  const bestAudio = [...audioOnly].sort((a, b) => (fmtBytes(b, dur).bytes ?? 0) - (fmtBytes(a, dur).bytes ?? 0))[0];
  const pick = (maxH: number) =>
    video
      .filter((f) => (f.height ?? 0) <= maxH)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (fmtBytes(b, dur).bytes ?? 0) - (fmtBytes(a, dur).bytes ?? 0))[0];
  const sizeOf = (v: YtFormat | undefined) => {
    if (!v) return '';
    const a = fmtBytes(v, dur);
    const b = hasAudio(v) || !bestAudio ? { bytes: 0, approx: false } : fmtBytes(bestAudio, dur);
    if (!a.bytes) return '';
    return formatSize(a.bytes + (b.bytes ?? 0), a.approx || b.approx || !hasAudio(v));
  };
  const out: QualityOption[] = [];
  if (video.length) {
    out.push({ key: 'best', label: 'Best', size: sizeOf(pick(Infinity)) });
    const top = Math.max(...video.map((f) => f.height ?? 0));
    for (const [i, h] of HEIGHTS.entries()) {
      if (h > top) continue;
      // Offer 480p only if a format between 361p and 480p exists, and so on.
      const lower = HEIGHTS[i + 1] ?? 0;
      if (!video.some((f) => f.height && f.height <= h && f.height > lower)) continue;
      out.push({ key: String(h), label: `${h}p`, size: sizeOf(pick(h)) });
    }
  }
  if (audioOnly.length || video.some(hasAudio)) {
    const a = fmtBytes(bestAudio, dur);
    out.push({ key: 'm4a', label: 'Audio only (M4A)', size: a.bytes ? formatSize(a.bytes, true) : '' });
    out.push({ key: 'mp3', label: 'Audio only (MP3)', size: a.bytes ? formatSize(a.bytes * 1.4, true) : '' });
  }
  if (!out.length) out.push({ key: 'best', label: 'Best', size: '' });
  return out;
}

/** Default popup choice: 1080p if offered, else the highest under it, else Best. */
export function defaultQuality(q: QualityOption[]): string {
  const heights = q.map((o) => Number(o.key)).filter((n) => n > 0);
  const under = heights.filter((h) => h <= 1080).sort((a, b) => b - a)[0];
  return under ? String(under) : (q[0]?.key ?? 'best');
}

/** Every URL a yt-dlp entry's formats point at (query stripped), for dropping duplicate captures. */
export function ytdlpUrls(info: YtInfo): Set<string> {
  const out = new Set<string>();
  for (const f of info.formats ?? []) {
    if (f.url) out.add(stripQuery(f.url));
    if (f.manifest_url) out.add(stripQuery(f.manifest_url));
  }
  if (info.url) out.add(stripQuery(info.url));
  return out;
}

// ---------------------------------------------------------------- yt-dlp jobs

/** -f / -x arguments for a popup quality. Captured streams use the height the variant had. */
export function ytdlpFormatArgs(quality: string): string[] {
  if (quality === 'm4a') return ['-f', 'ba/b', '-x', '--audio-format', 'm4a'];
  if (quality === 'mp3') return ['-f', 'ba/b', '-x', '--audio-format', 'mp3'];
  const h = Number(quality);
  if (h > 0) return ['-f', `bv*[height<=${h}]+ba/b[height<=${h}]`, '--merge-output-format', 'mp4'];
  if (/^b\d+$/.test(quality)) return ['-f', `bv*[tbr<=${Math.ceil(Number(quality.slice(1)) / 1000) + 1}]+ba/b`, '--merge-output-format', 'mp4'];
  return ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
}

/** "[720p]", "[Best]", "[Audio only]", '' for a single captured file. */
export function qualityTag(quality: string, label?: string): string {
  if (quality === 'file') return '';
  if (quality === 'm4a' || quality === 'mp3') return ' [Audio only]';
  if (quality === 'best') return ' [Best]';
  if (quality === 'single') return /^\d+p\b/.test(label ?? '') ? ` [${label!.split(' ')[0]}]` : '';
  const h = Number(quality);
  if (h > 0) return ` [${h}p]`;
  return label ? ` [${label.split(' · ')[0]}]` : '';
}

export function qualityExt(quality: string, fallback = 'mp4'): string {
  return quality === 'm4a' ? 'm4a' : quality === 'mp3' ? 'mp3' : fallback;
}

export interface YtProgress {
  status?: string;
  downloaded_bytes?: number;
  total_bytes?: number | null;
  total_bytes_estimate?: number | null;
  speed?: number | null;
  eta?: number | null;
  filename?: string;
  postprocessor?: string;
}

export type YtLine =
  | { kind: 'progress'; p: YtProgress }
  | { kind: 'post'; p: YtProgress }
  | { kind: 'path'; path: string }
  | { kind: 'error'; message: string }
  | { kind: 'other'; text: string };

export const PROGRESS_PREFIX = '__P__';
export const POST_PREFIX = '__PP__';

export function parseYtLine(line: string): YtLine {
  const l = line.trim();
  const json = (s: string): YtProgress | undefined => {
    try {
      return JSON.parse(s) as YtProgress;
    } catch {
      return undefined;
    }
  };
  if (l.startsWith(POST_PREFIX)) {
    const p = json(l.slice(POST_PREFIX.length));
    if (p) return { kind: 'post', p };
  } else if (l.startsWith(PROGRESS_PREFIX)) {
    const p = json(l.slice(PROGRESS_PREFIX.length));
    if (p) return { kind: 'progress', p };
  }
  if (/^ERROR:/.test(l)) return { kind: 'error', message: l.replace(/^ERROR:\s*/, '') };
  if (/^([a-z]:[\\/]|\/|\\\\)/i.test(l) && !l.includes('\t')) return { kind: 'path', path: l };
  return { kind: 'other', text: l };
}

/** What ffmpeg is doing, for the queue row; undefined = a step not worth showing. */
export function postNote(postprocessor?: string): string | undefined {
  switch (postprocessor) {
    case 'Merger':
      return 'Merging video and audio…';
    case 'ExtractAudio':
      return 'Extracting audio…';
    case 'FFmpegVideoConvertor':
    case 'FFmpegVideoRemuxer':
      return 'Converting to MP4…';
    case 'FixupM3u8':
    case 'FFmpegFixupM3u8':
    case 'FFmpegFixupM4a':
    case 'FFmpegFixupStretched':
    case 'FFmpegFixupDuplicateMoov':
      return 'Fixing up the file…';
    default:
      return undefined;
  }
}

/** Maps a yt-dlp ERROR line to the app's error codes (tech doc: V2 errors). */
export function mapYtdlpError(message: string): ErrorCode {
  const m = message.toLowerCase();
  if (/http error 403|403: forbidden|status code 403/.test(m)) return 'LINK_EXPIRED';
  if (/requested format is not available|no video formats found|format is not available/.test(m)) return 'FORMAT_UNAVAILABLE';
  if (/postprocessing|merg|ffmpeg|conversion failed/.test(m)) return 'MERGE_FAILED';
  if (/no space left|permission denied|errno 28|errno 13/.test(m)) return 'DISK_ERROR';
  if (/timed out|connection|getaddrinfo|network is unreachable|temporary failure/.test(m)) return 'NETWORK';
  if (/sign in|login required|private video|members-only/.test(m)) return 'AUTH_REQUIRED';
  return 'EXTRACTOR';
}

// ---------------------------------------------------------------- cookies

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly?: boolean;
  session?: boolean;
}

/** Netscape cookies.txt, the format yt-dlp's --cookies reads. */
export function toNetscapeCookies(cookies: CdpCookie[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# Written by Desktop Downloader for one capture session.', ''];
  for (const c of cookies) {
    if (/[\t\r\n]/.test(c.name + c.value + c.domain + c.path)) continue;
    const domain = c.httpOnly ? `#HttpOnly_${c.domain}` : c.domain;
    const sub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const exp = c.session || c.expires <= 0 ? 0 : Math.floor(c.expires);
    lines.push([domain, sub, c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(exp), c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

/** The page URL list scanned at session end: unique, http(s) only, fragments dropped, pasted link excluded. */
export function pagesToScan(visited: string[], pasted: string): string[] {
  const norm = (u: string) => u.split('#')[0].replace(/\/$/, '');
  const skip = norm(pasted);
  const out: string[] = [];
  const seen = new Set<string>([skip]);
  for (const u of visited) {
    if (!/^https?:\/\//i.test(u)) continue;
    const n = norm(u);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(u.split('#')[0]);
  }
  return out;
}

/** "keebblog.example.com/switch-roundup" */
export function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).slice(0, 120);
  } catch {
    return u.slice(0, 120);
  }
}

export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
