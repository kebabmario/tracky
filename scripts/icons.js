// Renders the Tracky logo (blue rounded square + yellow trend line) to PNG app icons, no dependencies.
// Run: node scripts/icons.js
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [0x25, 0x47, 0xff], YELLOW = [0xff, 0xd8, 0x4d];
const LINE = [[7, 21.5], [12.5, 16], [16.5, 19.5], [25, 11]]; // logo.svg path, 32-unit box

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// maskable: full-bleed square, artwork shrunk into the 80% safe zone.
function render(size, maskable) {
  const s = size / 32, ss = 4; // 4x4 supersampling for anti-aliasing
  const scale = maskable ? 0.72 : 1, off = (32 - 32 * scale) / 2;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (x + (sx + .5) / ss) / s, v = (y + (sy + .5) / ss) / s; // 0..32
      let inBox = true;
      if (!maskable) { // rounded rect rx=9
        const cx = Math.min(Math.max(u, 9), 23), cy = Math.min(Math.max(v, 9), 23);
        inBox = Math.hypot(u - cx, v - cy) <= 9;
      }
      if (!inBox) continue;
      const lu = (u - off) / scale, lv = (v - off) / scale;
      const onLine = Math.min(...LINE.slice(1).map((p, i) => segDist(lu, lv, LINE[i], p))) <= 1.5;
      const c = onLine ? YELLOW : BLUE;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = ss * ss, i = (y * size + x) * 4, cov = a / 255;
    px[i] = cov ? r / cov : 0; px[i + 1] = cov ? g / cov : 0; px[i + 2] = cov ? b / cov : 0; px[i + 3] = a / n;
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = ~0; for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  writeFileSync(new URL(name, out), render(size, maskable));
  console.log('wrote', name);
}
