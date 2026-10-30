#!/usr/bin/env node
// Writes docs/sprites.png: every pose (columns) for every evolution stage
// (rows), scaled up with nearest-neighbour. Pure Node (zlib PNG encoder).
//   node scripts/sprite-sheet.mjs [out.png] [scale]
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildFrame, frameToBitmap, SIZE } from '../src/pet/sprites.js';

const POSES = [['idle', 0.1], ['walk', 0.2], ['talk', 0.0], ['cheer', 0.12], ['sleep', 0.6], ['worry', 0.1]];
const out = path.resolve(process.argv[2] || 'docs/sprites.png');
const scale = Number(process.argv[3]) || 6;
const cell = SIZE * scale, pad = 12;
const W = POSES.length * (cell + pad) + pad, H = 4 * (cell + pad) + pad;
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // soft checker so transparency shows
  const i = (y * W + x) * 4, c = ((x >> 3) + (y >> 3)) % 2 ? 244 : 232;
  rgba[i] = c; rgba[i + 1] = c; rgba[i + 2] = c + 6; rgba[i + 3] = 255;
}
for (let stage = 1; stage <= 4; stage++) POSES.forEach(([state, t], col) => {
  const bmp = frameToBitmap(buildFrame({ state, stage, t }), scale);
  const ox = pad + col * (cell + pad), oy = pad + (stage - 1) * (cell + pad);
  for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
    const s = (y * bmp.width + x) * 4;
    if (!bmp.data[s + 3]) continue;
    const d = ((oy + y) * W + ox + x) * 4;
    rgba[d] = bmp.data[s]; rgba[d + 1] = bmp.data[s + 1]; rgba[d + 2] = bmp.data[s + 2]; rgba[d + 3] = 255;
  }
});

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out} (${W}x${H}; columns: ${POSES.map((p) => p[0]).join(', ')}; rows: stages 1-4)`);
