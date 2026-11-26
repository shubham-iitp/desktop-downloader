import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { infoHashFromMagnet, infoHashFromTorrent } from '../src/main/torrentHash';

const HEX = 'e75a1a6b922815d64cfa9b8904208d3a85143495';

function hexToBase32(hex: string): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...Buffer.from(hex, 'hex')].map((b) => b.toString(2).padStart(8, '0')).join('');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

describe('infoHashFromMagnet', () => {
  it('reads hex and base32 btih, case-insensitively', () => {
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=x`)).toBe(HEX);
    expect(infoHashFromMagnet(`magnet:?dn=x&xt=urn:btih:${hexToBase32(HEX)}`)).toBe(HEX);
  });
  it('returns undefined without a btih', () => {
    expect(infoHashFromMagnet('magnet:?dn=only-a-name')).toBeUndefined();
    expect(infoHashFromMagnet('magnet:?xt=urn:btih:nothex')).toBeUndefined();
  });
});

describe('infoHashFromTorrent', () => {
  it('hashes exactly the bencoded info dictionary', () => {
    const info = 'd6:lengthi1024e4:name8:file.bin12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae';
    const torrent = Buffer.from(`d8:announce19:http://t.example/a/4:infod${info.slice(1)}e`, 'latin1');
    // Rebuild the expected bytes the same way the torrent embeds them.
    const expected = crypto.createHash('sha1').update(Buffer.from(info, 'latin1')).digest('hex');
    expect(infoHashFromTorrent(torrent)).toBe(expected);
  });
  it('ignores a nested "info" key that is not top-level', () => {
    const t = Buffer.from('d4:metad4:infoi1eee', 'latin1');
    expect(infoHashFromTorrent(t)).toBeUndefined();
  });
  it('rejects malformed input', () => {
    expect(infoHashFromTorrent(Buffer.from('not bencode'))).toBeUndefined();
    expect(infoHashFromTorrent(Buffer.from('d4:info'))).toBeUndefined();
  });
});
