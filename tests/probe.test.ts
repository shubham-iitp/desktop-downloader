import { describe, expect, it } from 'vitest';
import { filenameFromDisposition, interpretResponse, routeLink, sanitizeFilename } from '../src/main/probeParse';

const res = (status: number, headers: Record<string, string>, finalUrl = '') => ({
  status,
  finalUrl,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }
});

describe('routeLink', () => {
  it('routes by scheme and extension', () => {
    expect(routeLink('magnet:?xt=urn:btih:abc')).toBe('torrent');
    expect(routeLink('https://x.org/a.torrent')).toBe('torrent');
    expect(routeLink('C:\\Users\\me\\a.torrent')).toBe('torrent');
    expect(routeLink('https://x.org/a.iso.meta4')).toBe('metalink');
    expect(routeLink('ftp://x.org/a.iso')).toBe('ftp');
    expect(routeLink('sftp://x.org/a.iso')).toBe('ftp');
    expect(routeLink('https://x.org/a.iso?x=1')).toBe('http');
    expect(routeLink('file:///etc/passwd')).toBe('invalid');
    expect(routeLink('javascript:alert(1)')).toBe('invalid');
  });
});

describe('filenames', () => {
  it('reads Content-Disposition, including RFC 5987 names', () => {
    expect(filenameFromDisposition('attachment; filename="report.pdf"')).toBe('report.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf")).toBe('résumé.pdf');
    expect(filenameFromDisposition('inline')).toBeUndefined();
  });
  it('strips path separators and reserved names', () => {
    expect(sanitizeFilename('../../evil.exe')).toBe('.._.._evil.exe');
    expect(sanitizeFilename('a/b\\c.txt')).toBe('a_b_c.txt');
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('name. ')).toBe('name');
    expect(sanitizeFilename('a<b>:c?.txt')).toBe('a_b__c_.txt');
  });
});

describe('interpretResponse', () => {
  const url = 'https://dl.example.com/files/app.zip';

  it('reads size and resume support', () => {
    const r = interpretResponse(url, res(200, { 'content-length': '1048576', 'accept-ranges': 'bytes', 'content-type': 'application/zip' }, url));
    expect(r).toMatchObject({ kind: 'file', filename: 'app.zip', size: 1048576, resumable: true, host: 'dl.example.com', protocol: 'HTTPS' });
    expect(r.error).toBeUndefined();
  });

  it('uses the Content-Range total on a 206', () => {
    const r = interpretResponse(url, res(206, { 'content-range': 'bytes 0-0/5000' }, url));
    expect(r.size).toBe(5000);
    expect(r.resumable).toBe(true);
  });

  it('marks no Accept-Ranges as not resumable and unknown size', () => {
    const r = interpretResponse(url, res(200, { 'content-type': 'application/octet-stream' }, url));
    expect(r.resumable).toBe(false);
    expect(r.size).toBeNull();
  });

  it('rejects web pages unless served as an attachment', () => {
    expect(interpretResponse(url, res(200, { 'content-type': 'text/html; charset=utf-8' }, url)).error?.code).toBe('NOT_A_FILE');
    const att = interpretResponse(url, res(200, { 'content-type': 'text/html', 'content-disposition': 'attachment; filename="page.html"' }, url));
    expect(att.error).toBeUndefined();
    expect(att.filename).toBe('page.html');
  });

  it('maps auth and HTTP errors', () => {
    expect(interpretResponse(url, res(401, {}, url)).error).toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(interpretResponse(url, res(403, {}, url)).error?.code).toBe('AUTH_REQUIRED');
    expect(interpretResponse(url, res(404, {}, url)).error).toMatchObject({ code: 'HTTP_ERROR', status: 404 });
  });

  it('takes the name from the final URL after redirects', () => {
    const r = interpretResponse('https://short.link/x', res(200, { 'content-length': '10' }, 'https://cdn.example.com/real-name.iso'));
    expect(r.filename).toBe('real-name.iso');
  });

  it('detects metalink by name', () => {
    expect(interpretResponse(url, res(200, {}, 'https://m.example.org/ubuntu.iso.meta4')).kind).toBe('metalink');
  });
});
