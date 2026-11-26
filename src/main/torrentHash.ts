import crypto from 'node:crypto';

/* Torrent info-hash helpers (no Electron imports, so they run under Vitest). */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(s: string): string | undefined {
  let bits = '';
  for (const ch of s.toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) return undefined;
    bits += v.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex.slice(0, 40);
}

/** Lower-case hex v1 info-hash from a magnet link (hex or base32 btih), if present. */
export function infoHashFromMagnet(uri: string): string | undefined {
  const m = /[?&]xt=urn:btih:([A-Za-z0-9]+)/i.exec(uri);
  if (!m) return undefined;
  const v = m[1];
  if (/^[0-9a-f]{40}$/i.test(v)) return v.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(v)) return base32ToHex(v);
  return undefined;
}

/** SHA-1 of the bencoded `info` dictionary of a .torrent file. */
export function infoHashFromTorrent(buf: Buffer): string | undefined {
  let i = 0;
  let info: [number, number] | undefined;
  const fail = () => {
    throw new Error('bad bencode');
  };
  const parse = (depth: number): void => {
    if (depth > 64 || i >= buf.length) fail();
    const c = buf[i];
    if (c === 0x64 /* d */) {
      i++;
      while (buf[i] !== 0x65 /* e */) {
        const kStart = i;
        parse(depth + 1);
        const key = readString(kStart);
        const vStart = i;
        parse(depth + 1);
        if (depth === 0 && key === 'info') info = [vStart, i];
        if (i >= buf.length) fail();
      }
      i++;
    } else if (c === 0x6c /* l */) {
      i++;
      while (buf[i] !== 0x65) {
        parse(depth + 1);
        if (i >= buf.length) fail();
      }
      i++;
    } else if (c === 0x69 /* i */) {
      const end = buf.indexOf(0x65, i);
      if (end < 0) fail();
      i = end + 1;
    } else if (c >= 0x30 && c <= 0x39) {
      const colon = buf.indexOf(0x3a, i);
      if (colon < 0) fail();
      const len = Number(buf.subarray(i, colon).toString());
      if (!Number.isFinite(len)) fail();
      i = colon + 1 + len;
      if (i > buf.length) fail();
    } else fail();
  };
  const readString = (start: number): string => {
    const colon = buf.indexOf(0x3a, start);
    return buf.subarray(colon + 1, i).toString('latin1');
  };
  try {
    parse(0);
  } catch {
    return undefined;
  }
  return info ? crypto.createHash('sha1').update(buf.subarray(info[0], info[1])).digest('hex') : undefined;
}
