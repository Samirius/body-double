#!/usr/bin/env node
// Writes docs/nudgling.ico (shortcut icon) and docs/nudgling.png (256 px):
// the familiar's idle pose, stage 1, on a transparent background. The .ico
// wraps the PNG (supported since Windows Vista). Pure Node.
//   node scripts/icon.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrame, frameToBitmap, SIZE } from '../src/pet/sprites.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = 256, scale = Math.floor(N / SIZE), off = Math.floor((N - SIZE * scale) / 2);
const bmp = frameToBitmap(buildFrame({ state: 'idle', stage: 1, t: 0.1 }), scale);
const rgba = Buffer.alloc(N * N * 4);
for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
  const s = (y * bmp.width + x) * 4, d = ((off + y) * N + off + x) * 4;
  for (let k = 0; k < 4; k++) rgba[d + k] = bmp.data[s + k];
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) rgba.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

// ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) + the PNG. 0 means 256 px.
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 0; head[7] = 0; head[8] = 0; head[9] = 0;
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);

mkdirSync(path.join(root, 'docs'), { recursive: true });
writeFileSync(path.join(root, 'docs', 'nudgling.png'), png);
writeFileSync(path.join(root, 'docs', 'nudgling.ico'), Buffer.concat([head, png]));
console.log('docs/nudgling.ico + docs/nudgling.png');
