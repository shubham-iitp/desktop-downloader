import { describe, expect, it } from 'vitest';
import {
  classifyResponse,
  defaultQuality,
  formatSize,
  hlsHasDrm,
  isoDuration,
  mapYtdlpError,
  pagesToScan,
  parseDash,
  parseHls,
  parseYtLine,
  postNote,
  qualityTag,
  safeHlsMaster,
  singleQuality,
  sizeFromHeaders,
  streamQualities,
  stripQuery,
  toNetscapeCookies,
  ytdlpFormatArgs,
  ytdlpQualities,
  ytdlpUrls,
  type YtInfo
} from '../src/main/capture/classify';

describe('classifyResponse', () => {
  it('recognises HLS and DASH by extension or content type', () => {
    expect(classifyResponse({ url: 'https://cdn.example/v/master.m3u8?sig=1' })).toBe('hls');
    expect(classifyResponse({ url: 'https://cdn.example/play', mimeType: 'application/vnd.apple.mpegurl' })).toBe('hls');
    expect(classifyResponse({ url: 'https://cdn.example/play', mimeType: 'application/x-mpegURL; charset=utf-8' })).toBe('hls');
    expect(classifyResponse({ url: 'https://cdn.example/manifest.mpd' })).toBe('dash');
    expect(classifyResponse({ url: 'https://cdn.example/m', mimeType: 'application/dash+xml' })).toBe('dash');
  });

  it('keeps progressive files over 1 MB only', () => {
    expect(classifyResponse({ url: 'https://media.example/clip.mp4', mimeType: 'video/mp4', size: 48_000_000 })).toBe('progressive');
    expect(classifyResponse({ url: 'https://media.example/a', mimeType: 'audio/mpeg', size: 4_000_000 })).toBe('progressive');
    expect(classifyResponse({ url: 'https://media.example/tiny.mp4', mimeType: 'video/mp4', size: 200_000 })).toBeUndefined();
    expect(classifyResponse({ url: 'https://media.example/clip.webm', size: 2_000_000 })).toBe('progressive');
  });

  it('treats segments as playback only, and ignores everything else', () => {
    expect(classifyResponse({ url: 'https://cdn.example/seg-00012.ts' })).toBe('segment');
    expect(classifyResponse({ url: 'https://cdn.example/chunk-3.m4s' })).toBe('segment');
    expect(classifyResponse({ url: 'https://example.com/', mimeType: 'text/html' })).toBeUndefined();
    expect(classifyResponse({ url: 'https://example.com/a.png', mimeType: 'image/png', size: 5_000_000 })).toBeUndefined();
    expect(classifyResponse({ url: 'blob:https://example.com/123', mimeType: 'video/mp4', size: 9e9 })).toBeUndefined();
    expect(classifyResponse({ url: 'https://cdn.example/x.m3u8', status: 404 })).toBeUndefined();
  });

  it('reads the full size from Content-Range on a 206', () => {
    expect(sizeFromHeaders({ 'Content-Length': '1024', 'Content-Range': 'bytes 0-1023/48000000' })).toBe(48_000_000);
    expect(sizeFromHeaders({ 'content-length': '5000000' })).toBe(5_000_000);
    expect(sizeFromHeaders({})).toBeUndefined();
  });
});

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720
720/index.m3u8?token=abc
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480
https://other.example/480.m3u8
`;
const CLEAR_MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg0.ts
#EXTINF:6.0,
seg1.ts
#EXTINF:4.5,
seg2.ts
#EXT-X-ENDLIST`;
const AES128 = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1"
#EXTINF:6.0,
seg0.ts`;
const SAMPLE_AES = `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"
#EXTINF:6.0,
seg0.ts`;
const WIDEVINE = `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:text/plain;base64,AAA",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"
#EXTINF:6.0,
seg0.ts`;
const PLAYREADY_SESSION = `#EXTM3U
#EXT-X-SESSION-KEY:METHOD=AES-128,URI="x",KEYFORMAT="com.microsoft.playready"
#EXT-X-STREAM-INF:BANDWIDTH=1000000
a.m3u8`;

describe('HLS', () => {
  it('lists master playlist variants with absolute URLs', () => {
    const h = parseHls(MASTER, 'https://cdn.example/live/master.m3u8');
    expect(h.master).toBe(true);
    expect(h.variants.map((v) => v.height)).toEqual([1080, 720, 480]);
    expect(h.variants[0].url).toBe('https://cdn.example/live/1080/index.m3u8');
    expect(h.variants[1].url).toBe('https://cdn.example/live/720/index.m3u8?token=abc');
    expect(h.variants[2].url).toBe('https://other.example/480.m3u8');
    expect(h.drm).toBe(false);
  });

  it('sums EXTINF for a media playlist', () => {
    const h = parseHls(CLEAR_MEDIA, 'https://cdn.example/a/index.m3u8');
    expect(h.master).toBe(false);
    expect(h.duration).toBeCloseTo(16.5);
  });

  it('lists a media playlist’s segments and labels its one quality', () => {
    const h = parseHls(CLEAR_MEDIA, 'https://cdn.example/a/index.m3u8');
    expect(h.segments).toEqual(['https://cdn.example/a/seg0.ts', 'https://cdn.example/a/seg1.ts', 'https://cdn.example/a/seg2.ts']);
    expect(singleQuality(1080, 1_900_000_000)).toEqual({ key: 'single', label: '1080p', size: '~1.9 GB' });
    expect(singleQuality(undefined, undefined)).toEqual({ key: 'single', label: 'Original quality', size: '' });
    expect(qualityTag('single', '1080p')).toBe(' [1080p]');
    expect(qualityTag('single', 'Original quality')).toBe('');
  });

  it('keeps clear and AES-128 streams, drops SAMPLE-AES and DRM key formats', () => {
    expect(hlsHasDrm(CLEAR_MEDIA)).toBe(false);
    expect(hlsHasDrm(AES128)).toBe(false);
    expect(hlsHasDrm(SAMPLE_AES)).toBe(true);
    expect(hlsHasDrm(WIDEVINE)).toBe(true);
    expect(hlsHasDrm(PLAYREADY_SESSION)).toBe(true);
  });

  it('builds quality options from variants, highest first, with estimated sizes', () => {
    const v = parseHls(MASTER, 'https://cdn.example/m.m3u8').variants;
    const q = streamQualities(v, 3730);
    expect(q.map((o) => o.key)).toEqual(['1080', '720', '480']);
    expect(q[1].label).toBe('720p · 3.2 Mbps');
    expect(q[1].size).toBe('~1.5 GB');
    expect(streamQualities([], undefined)).toEqual([{ key: 'best', label: 'Best available', size: '' }]);
  });
});

const DASH_CLEAR = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1H2M10S" type="static">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v1" bandwidth="6000000" width="1920" height="1080"/>
      <Representation id="v2" bandwidth="3000000" width="1280" height="720"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="a1" bandwidth="128000"/>
    </AdaptationSet>
  </Period>
</MPD>`;
const DASH_DRM = DASH_CLEAR.replace(
  '<AdaptationSet contentType="video" mimeType="video/mp4">',
  '<AdaptationSet contentType="video" mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>'
);

describe('safeHlsMaster', () => {
  it('makes URIs absolute and track names Windows-safe, keeping group references matched', () => {
    const src = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud (main)",NAME="Original | English (United Kingdom)",URI="a/en.m3u8?t=1"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud (main)",CLOSED-CAPTIONS=NONE',
      'v/360.m3u8'
    ].join('\n');
    const out = safeHlsMaster(src, 'https://p1.example/api/stream/x/master.m3u8').split('\n');
    expect(out[1]).toBe('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud_main",NAME="Original_English_United_Kingdom",URI="https://p1.example/api/stream/x/a/en.m3u8?t=1"');
    expect(out[2]).toContain('AUDIO="aud_main"');
    expect(out[2]).toContain('CLOSED-CAPTIONS=NONE');
    expect(out[3]).toBe('https://p1.example/api/stream/x/v/360.m3u8');
  });
});

describe('DASH', () => {
  it('reads representations, kinds and duration', () => {
    const d = parseDash(DASH_CLEAR);
    expect(d.drm).toBe(false);
    expect(d.duration).toBe(3730);
    expect(d.representations.filter((r) => r.kind === 'video').map((r) => r.height)).toEqual([1080, 720]);
    expect(d.representations.find((r) => r.id === 'a1')?.kind).toBe('audio');
  });

  it('flags ContentProtection as DRM', () => {
    expect(parseDash(DASH_DRM).drm).toBe(true);
    expect(parseDash(DASH_CLEAR.replace(/<Period>/, '<Period><cenc:ContentProtection xmlns:cenc="x"/>')).drm).toBe(true);
  });

  it('parses ISO 8601 durations', () => {
    expect(isoDuration('PT18M42S')).toBe(1122);
    expect(isoDuration('PT0.5S')).toBe(0.5);
    expect(isoDuration('P1DT1H')).toBe(90000);
    expect(isoDuration('nonsense')).toBeUndefined();
  });
});

const YT: YtInfo = {
  id: 'k3yb0ard',
  title: 'Building a mechanical keyboard from scratch',
  duration: 1122,
  webpage_url: 'https://www.youtube.com/watch?v=k3yb0ard',
  formats: [
    { format_id: '140', acodec: 'mp4a.40.2', vcodec: 'none', filesize: 17_000_000, url: 'https://rr1.googlevideo.com/a?x=1' },
    { format_id: '137', vcodec: 'avc1', acodec: 'none', height: 1080, filesize: 393_000_000, url: 'https://rr1.googlevideo.com/v1080?x=1' },
    { format_id: '136', vcodec: 'avc1', acodec: 'none', height: 720, filesize_approx: 193_000_000, url: 'https://rr1.googlevideo.com/v720' },
    { format_id: '18', vcodec: 'avc1', acodec: 'mp4a', height: 360, tbr: 500, url: 'https://rr1.googlevideo.com/v360' },
    { format_id: 'drm4k', vcodec: 'vp9', acodec: 'none', height: 2160, filesize: 1_600_000_000, has_drm: true, url: 'https://rr1.googlevideo.com/drm' }
  ]
};

describe('yt-dlp qualities', () => {
  it('offers Best, each available height and the audio presets, without DRM formats', () => {
    const q = ytdlpQualities(YT);
    // 2160p only existed as a DRM format, and nothing sits between 361p and 480p.
    expect(q.map((o) => o.key)).toEqual(['best', '1080', '720', '360', 'm4a', 'mp3']);
    // Video + audio merged into one file: an estimate.
    expect(q.find((o) => o.key === '1080')?.size).toBe('~410 MB');
    expect(q.find((o) => o.key === '720')?.size).toBe('~210 MB');
    expect(q.find((o) => o.key === 'm4a')?.size).toBe('~17 MB');
  });

  it('skips entries whose formats are all DRM', () => {
    expect(ytdlpQualities({ ...YT, formats: [{ vcodec: 'vp9', height: 1080, has_drm: true }] })).toEqual([]);
  });

  it('defaults to 1080p, else the highest under it', () => {
    expect(defaultQuality(ytdlpQualities(YT))).toBe('1080');
    expect(defaultQuality([{ key: 'best', label: 'Best', size: '' }, { key: '2160', label: '2160p', size: '' }, { key: '720', label: '720p', size: '' }])).toBe('720');
    expect(defaultQuality([{ key: 'file', label: 'MP4 · single file', size: '48 MB' }])).toBe('file');
  });

  it('collects format and manifest URLs for dropping captured duplicates', () => {
    const urls = ytdlpUrls({ formats: [{ url: 'https://cdn.example/v.m3u8?sig=9', manifest_url: 'https://cdn.example/master.m3u8?t=1' }] });
    expect(urls.has(stripQuery('https://cdn.example/master.m3u8?t=2'))).toBe(true);
    expect(urls.has('https://cdn.example/v.m3u8')).toBe(true);
  });
});

describe('yt-dlp jobs', () => {
  it('maps qualities to format arguments', () => {
    expect(ytdlpFormatArgs('720')).toEqual(['-f', 'bv*[height<=720]+ba/b[height<=720]', '--merge-output-format', 'mp4']);
    expect(ytdlpFormatArgs('best')).toEqual(['-f', 'bv*+ba/b', '--merge-output-format', 'mp4']);
    expect(ytdlpFormatArgs('m4a')).toEqual(['-f', 'ba/b', '-x', '--audio-format', 'm4a']);
    expect(ytdlpFormatArgs('mp3')).toEqual(['-f', 'ba/b', '-x', '--audio-format', 'mp3']);
  });

  it('puts the quality in the file name', () => {
    expect(qualityTag('720')).toBe(' [720p]');
    expect(qualityTag('best')).toBe(' [Best]');
    expect(qualityTag('m4a')).toBe(' [Audio only]');
    expect(qualityTag('file')).toBe('');
  });

  it('parses progress, postprocessing, the final path and errors', () => {
    expect(parseYtLine('__P__{"status":"downloading","downloaded_bytes":1000,"total_bytes":4000,"speed":500,"eta":6}')).toEqual({
      kind: 'progress',
      p: { status: 'downloading', downloaded_bytes: 1000, total_bytes: 4000, speed: 500, eta: 6 }
    });
    expect(parseYtLine('__PP__{"status":"started","postprocessor":"Merger"}')).toEqual({ kind: 'post', p: { status: 'started', postprocessor: 'Merger' } });
    expect(parseYtLine('D:\\Downloads\\Videos\\Title [720p].mp4')).toEqual({ kind: 'path', path: 'D:\\Downloads\\Videos\\Title [720p].mp4' });
    expect(parseYtLine('/home/me/Videos/a.mp4').kind).toBe('path');
    expect(parseYtLine('ERROR: [youtube] k3: Requested format is not available')).toEqual({ kind: 'error', message: '[youtube] k3: Requested format is not available' });
    expect(parseYtLine('[download] Destination: x').kind).toBe('other');
    expect(postNote('Merger')).toBe('Merging video and audio…');
    expect(postNote('MoveFiles')).toBeUndefined();
  });

  it('maps yt-dlp errors to the tech doc’s cases', () => {
    expect(mapYtdlpError('unable to download video data: HTTP Error 403: Forbidden')).toBe('LINK_EXPIRED');
    expect(mapYtdlpError('[youtube] x: Requested format is not available. Use --list-formats')).toBe('FORMAT_UNAVAILABLE');
    expect(mapYtdlpError('Postprocessing: Conversion failed!')).toBe('MERGE_FAILED');
    expect(mapYtdlpError('[generic] Unsupported URL: https://x')).toBe('EXTRACTOR');
  });
});

describe('session helpers', () => {
  it('writes Netscape cookies for yt-dlp', () => {
    const txt = toNetscapeCookies([
      { name: 'SID', value: 'abc', domain: '.example.com', path: '/', expires: 1893456000.5, secure: true, httpOnly: true },
      { name: 'pref', value: '1', domain: 'www.example.com', path: '/', expires: -1, secure: false, session: true },
      { name: 'bad', value: 'a\tb', domain: 'x', path: '/', expires: 0, secure: false }
    ]);
    const lines = txt.trim().split('\n');
    expect(lines[0]).toBe('# Netscape HTTP Cookie File');
    expect(lines).toContain('#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1893456000\tSID\tabc');
    expect(lines).toContain('www.example.com\tFALSE\t/\tFALSE\t0\tpref\t1');
    expect(txt).not.toContain('bad');
  });

  it('scans each other page visited once', () => {
    expect(
      pagesToScan(
        ['https://blog.example/post', 'https://blog.example/post#c', 'https://blog.example/build-log', 'chrome://newtab/', 'https://blog.example/build-log/'],
        'https://blog.example/post'
      )
    ).toEqual(['https://blog.example/build-log']);
  });

  it('formats sizes like the design', () => {
    expect(formatSize(48_000_000)).toBe('48 MB');
    expect(formatSize(1_600_000_000, true)).toBe('~1.6 GB');
    expect(formatSize(undefined)).toBe('');
  });
});
