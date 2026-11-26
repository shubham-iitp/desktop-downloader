// Renders the app and tray icons (download arrow on the brand red) to PNG with no dependencies.
//   node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = path.resolve(import.meta.dirname, '../resources/icons');
fs.mkdirSync(out, { recursive: true });

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Shapes in a 24-unit box (same geometry as the in-app logo).
const SEGS = [
  [12, 3, 12, 15],
  [7, 10, 12, 15],
  [17, 10, 12, 15],
  [5, 21, 19, 21]
];
function distSeg(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function roundRectCoverage(px, py, size, r) {
  const cx = Math.min(Math.max(px, r), size - r);
  const cy = Math.min(Math.max(py, r), size - r);
  return Math.max(0, Math.min(1, r - Math.hypot(px - cx, py - cy) + 0.5));
}

/** mode: 'app' (white arrow on red tile), 'tray' (red arrow), 'template' (black arrow, macOS). */
function render(size, mode) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling
  const pad = mode === 'app' ? size * 0.2 : size * 0.04;
  const scale = (size - 2 * pad) / 24;
  const stroke = (mode === 'app' ? 2.4 : 2.8) / 2;
  const red = [197, 48, 48];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let glyph = 0;
      let tile = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const gx = (px - pad) / scale;
          const gy = (py - pad) / scale;
          if (SEGS.some((s) => distSeg(gx, gy, s) <= stroke)) glyph++;
          if (mode === 'app') tile += roundRectCoverage(px, py, size, size * 0.22);
        }
      }
      glyph /= SS * SS;
      tile /= SS * SS;
      const i = (y * size + x) * 4;
      if (mode === 'app') {
        const a = tile;
        const c = red.map((v) => Math.round(v * (1 - glyph) + 255 * glyph));
        buf.set([...c, Math.round(a * 255)], i);
      } else {
        const c = mode === 'template' ? [0, 0, 0] : red;
        buf.set([...c, Math.round(glyph * 255)], i);
      }
    }
  }
  return png(size, size, buf);
}

fs.writeFileSync(path.join(out, 'icon.png'), render(512, 'app'));
fs.writeFileSync(path.join(out, 'tray.png'), render(32, 'tray'));
fs.writeFileSync(path.join(out, 'trayTemplate.png'), render(16, 'template'));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), render(32, 'template'));
console.log('icons written to', path.relative(process.cwd(), out));
