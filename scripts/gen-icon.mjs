// Генерирует client/public/apple-touch-icon.png — квадратную иконку игры
// (для «Добавить на экран "Домой"» на iOS). Запуск: `node scripts/gen-icon.mjs`
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 180;
const img = Buffer.alloc(S * S * 4);

const setPx = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
};

// Фон: вертикальный градиент
for (let y = 0; y < S; y++) {
  const t = y / (S - 1);
  let [r1, g1, b1] = [0x1e, 0x1b, 0x4b];
  let [r2, g2, b2] = [0x0f, 0x17, 0x2a];
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  for (let x = 0; x < S; x++) setPx(x, y, r, g, b);
}

function fillRoundedRect(x, y, w, h, rad, [r, g, b]) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx, cy = y + dy;
      const nx = dx < rad ? rad - dx - 1 : dx > w - rad ? dx - (w - rad) : 0;
      const ny = dy < rad ? rad - dy - 1 : dy > h - rad ? dy - (h - rad) : 0;
      if (nx > 0 && ny > 0) {
        if (nx * nx + ny * ny > rad * rad) continue;
      }
      setPx(cx, cy, r, g, b);
    }
  }
}

function strokeRoundedRect(x, y, w, h, rad, color, width) {
  for (let dy = 0; dy <= h; dy++) {
    for (let dx = 0; dx <= w; dx++) {
      const onEdge =
        (dx <= width || dx >= w - width || dy <= width || dy >= h - width)
        && !(dx > width && dx < w - width && dy > width && dy < h - width);
      if (!onEdge) continue;
      const cx = x + dx, cy = y + dy;
      const nx = dx < rad ? rad - dx - 1 : dx > w - rad ? dx - (w - rad) : 0;
      const ny = dy < rad ? rad - dy - 1 : dy > h - rad ? dy - (h - rad) : 0;
      if (nx > 0 && ny > 0 && nx * nx + ny * ny > rad * rad) continue;
      setPx(cx, cy, ...color);
    }
  }
}

// Блочный шрифт 3x5 для цифр
const DIGITS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

function drawText(str, cx, cy, scale, [r, g, b]) {
  const nChar = str.length;
  const pw = nChar * 3 * scale;
  const ph = 5 * scale;
  const ox = Math.round(cx - pw / 2);
  const oy = Math.round(cy - ph / 2);
  [...str].forEach((ch, ci) => {
    const rows = DIGITS[ch];
    for (let yy = 0; yy < 5; yy++) {
      for (let xx = 0; xx < 3; xx++) {
        if (rows[yy][xx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPx(ox + ci * 3 * scale + xx * scale + sx, oy + yy * scale + sy, r, g, b);
          }
        }
      }
    }
  });
}

// Фишки 2x2, как в логотипе: 1R, 7B, 13K, 3Y
const TILE = 70, RX = 14, GAP = 8;
const origin = (S - (TILE * 2 + GAP)) / 2;
const tiles = [
  { x: origin, y: origin, fill: [0xef, 0x44, 0x44], num: '1', scale: 9, color: [0x0f, 0x17, 0x2a] },
  { x: origin + TILE + GAP, y: origin, fill: [0x3b, 0x82, 0xf6], num: '7', scale: 9, color: [255, 255, 255] },
  { x: origin, y: origin + TILE + GAP, fill: [0x1e, 0x29, 0x3b], num: '13', scale: 7, color: [255, 255, 255] },
  { x: origin + TILE + GAP, y: origin + TILE + GAP, fill: [0xf5, 0x9e, 0x0b], num: '3', scale: 9, color: [0x0f, 0x17, 0x2a] },
];

for (const t of tiles) {
  fillRoundedRect(t.x, t.y, TILE, TILE, RX, t.fill);
  strokeRoundedRect(t.x, t.y, TILE, TILE, RX, [255, 255, 255, 72], 3);
  drawText(t.num, t.x + TILE / 2, t.y + TILE / 2 + 2, t.scale, t.color);
}

function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), encodePNG(S, S, img));
console.log('OK: client/public/apple-touch-icon.png (180x180)');