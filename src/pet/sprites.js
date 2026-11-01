// Procedural pixel-art familiar. Pure functions (no DOM), shared by the pet
// renderer, the tray icon and the tests. A frame is a 24x24 grid of palette
// keys; the renderer scales it up with nearest-neighbour.
//   states: idle | walk | talk | cheer | sleep | worry
//   stage:  1 mint blob, 2 sky + antenna, 3 violet + wings, 4 gold + crown

export const SIZE = 24;

const BASE = { o: '#1e1b2e', w: '#f8fafc', k: '#111827', m: '#7f1d1d', p: '#fb7185', y: '#facc15', z: '#818cf8', g: '#fef3c7' };
// Neon palettes (cyberpunk HUD): bright body, hot highlight, deep shade.
export const STAGE_COLORS = {
  1: { b: '#39ffb0', l: '#b8ffe4', d: '#00b37a' },
  2: { b: '#22e4ff', l: '#b5f7ff', d: '#0088c7' },
  3: { b: '#c45bff', l: '#ecc4ff', d: '#7a1fd1' },
  4: { b: '#ffd23a', l: '#fff3b0', d: '#e08a00' },
};
// Glow around the pet per stage (the renderer turns it red while you drift).
export const STAGE_GLOW = { 1: '#39ffb0', 2: '#22e4ff', 3: '#ff2bd6', 4: '#ffd23a' };
export const paletteFor = (stage) => ({ ...BASE, ...(STAGE_COLORS[stage] || STAGE_COLORS[1]) });

function grid() { return Array.from({ length: SIZE }, () => Array(SIZE).fill('')); }
const put = (g, x, y, v) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) g[y][x] = v; };
const stamp = (g, x0, y0, rows, map = {}) => rows.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') put(g, x0 + dx, y0 + dy, map[ch] ?? ch); }));

function body(g, cx, cy, rx, ry) {
  const inside = (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    g[y][x] = edge ? 'o' : (nx < -0.25 && ny < -0.25 && nx * nx + ny * ny > 0.2 ? 'l' : nx + ny > 0.85 ? 'd' : 'b');
  }
}

function eyes(g, cx, cy, kind, look) {
  const L = Math.round(cx - 4), R = Math.round(cx + 2), Y = Math.round(cy - 2);
  for (const ex of [L, R]) {
    if (kind === 'closed') { stamp(g, ex, Y + 2, ['kk']); continue; }
    if (kind === 'happy') { stamp(g, ex - (ex === L ? 1 : 0), Y + 1, ['.k.', 'k.k']); continue; } // ^ ^
    stamp(g, ex, Y, ['ww', 'ww', 'ww']);
    const px = ex + (look > 0 ? 1 : 0);
    put(g, px, Y + 1, 'k'); put(g, px, Y + 2, 'k');
    if (kind === 'blink') { stamp(g, ex, Y, ['oo', '..', '..']); stamp(g, ex, Y + 1, ['bb', 'kk']); }
    if (kind === 'worry') { put(g, ex + (ex === L ? 1 : 0), Y - 1, 'o'); put(g, ex + (ex === L ? 0 : 1), Y - 2, 'o'); }
  }
}

function mouth(g, cx, cy, kind) {
  const x = Math.round(cx - 1), y = Math.round(cy + 2);
  if (kind === 'smile') stamp(g, x - 1, y, ['k..k', '.kk.']);
  else if (kind === 'open') stamp(g, x, y, ['kk', 'mm']);
  else if (kind === 'grin') stamp(g, x - 1, y, ['kkkk', 'kmmk', '.kk.']);
  else if (kind === 'small') stamp(g, x, y + 1, ['k']);
  else if (kind === 'wavy') stamp(g, x - 1, y + 1, ['k.k.', '.k.k']);
}

function arms(g, cx, cy, rx, pose, t) {
  const L = Math.round(cx - rx - 1), R = Math.round(cx + rx), y = Math.round(cy + 1);
  const down = ['o', 'o'];
  if (pose === 'cheer') { stamp(g, L - 1, y - 3, ['o.', '.o', '.o']); stamp(g, R, y - 3, ['.o', 'o.', 'o.']); return; }
  if (pose === 'sleep') return; // tucked in
  stamp(g, L, y, down);
  if (pose === 'talk' && Math.floor(t * 4) % 2 === 0) stamp(g, R, y - 2, ['.o', 'o.']);
  else stamp(g, R, y, down);

}

function feet(g, cx, footY, phase) {
  const lift = (i) => (phase === 0 ? 0 : (phase === 1) === (i === 0) ? -1 : 0);
  stamp(g, Math.round(cx - 6), footY + lift(0), ['oddo', '.oo.'], { d: 'd' });
  stamp(g, Math.round(cx + 2), footY + lift(1), ['oddo', '.oo.'], { d: 'd' });
}

function accessories(g, stage, cx, top, layer) {
  if (layer === 'back' && stage >= 3) {
    stamp(g, Math.round(cx - 12), Math.round(top + 2), ['..oo', '.oww', 'owww', '.oww', '..oo']);
    stamp(g, Math.round(cx + 8), Math.round(top + 2), ['oo..', 'wwo.', 'wwwo', 'wwo.', 'oo..']);
  }
  if (layer !== 'front') return;
  if (stage === 2 || stage === 3) {
    for (let i = 1; i <= 3; i++) put(g, cx - 0.5, top - i, 'o');
    stamp(g, Math.round(cx - 1.5), Math.round(top - 5), ['yy', 'yy']);
  }
  if (stage >= 4) stamp(g, Math.round(cx - 3.5), Math.round(top - 4), ['y.y.y.y', 'yyyyyyy', 'ypyyypy', 'yyyyyyy']);
}

function overlay(g, kind, t) {
  if (kind === 'zzz') {
    const off = Math.floor(t * 2) % 3;
    stamp(g, 16, 5 - off, ['zzzz', '..z.', '.z..', 'zzzz']);
    if (off > 0) stamp(g, 21, 2 - off, ['zzz', '.z.', 'zzz'].map((r, i) => (i === 1 ? '.z.' : r)));
  }
  if (kind === 'sparkles') {
    const on = Math.floor(t * 6) % 2 === 0;
    for (const [x, y] of on ? [[2, 5], [20, 3], [21, 12]] : [[3, 2], [19, 6], [1, 13]]) stamp(g, x - 1, y - 1, ['.y.', 'yyy', '.y.']);
  }
  if (kind === 'sweat') stamp(g, 20, 8, ['.z', 'zz', 'zz']);
}

// One animation frame. `t` is seconds (drives breathing, steps, blinks).
export function buildFrame({ state = 'idle', t = 0, stage = 1, facing = 1 } = {}) {
  const g = grid();
  const cx = 11.5;
  let cy = 13.5, rx = 8.5, ry = 7.6, jump = 0, phase = 0;
  const breathe = Math.sin(t * 2.4);
  if (state === 'idle' || state === 'talk' || state === 'worry') { ry += breathe * 0.25; rx -= breathe * 0.2; }
  if (state === 'sleep') { ry -= 0.6 + breathe * 0.2; rx += 0.5; cy += 0.6; }
  if (state === 'walk') { phase = 1 + (Math.floor(t * 6) % 2); jump = phase === 1 ? -0.5 : 0; }
  if (state === 'cheer') { jump = -Math.abs(Math.sin(t * 7)) * 3; ry += 0.4; }
  cy += jump;
  const top = cy - ry;

  accessories(g, stage, cx, top, 'back');
  body(g, cx, cy, rx, ry);
  arms(g, cx, cy, rx, state, t);
  feet(g, cx, Math.round(13.5 + 7.6) - 1, phase);
  const blink = state === 'idle' && t % 4 > 3.85;
  const eyeKind = state === 'sleep' ? 'closed' : state === 'cheer' ? 'happy' : state === 'worry' ? 'worry' : blink ? 'blink' : 'open';
  // Always drawn facing right; the mirror below turns the whole face (pupils
  // included) to the left, so the pet looks where it walks.
  eyes(g, cx, cy, eyeKind, 1);
  const talkOpen = Math.floor(t * 5) % 2 === 0;
  mouth(g, cx, cy, { idle: 'smile', walk: 'smile', talk: talkOpen ? 'open' : 'small', cheer: 'grin', sleep: 'small', worry: 'wavy' }[state] || 'smile');
  if (state === 'cheer' || state === 'talk') { put(g, cx - 6.5, cy + 1, 'p'); put(g, cx + 5.5, cy + 1, 'p'); }
  accessories(g, stage, cx, top, 'front');
  if (state === 'sleep') overlay(g, 'zzz', t);
  if (state === 'cheer') overlay(g, 'sparkles', t);
  if (state === 'worry') overlay(g, 'sweat', t);
  if (facing < 0) for (const row of g) row.reverse();
  return { size: SIZE, pixels: g, palette: paletteFor(stage) };
}

// RGBA bytes (for the tray icon via nativeImage.createFromBitmap, which
// expects BGRA on Windows: pass bgra=true).
export function frameToBitmap(frame, scale = 1, { bgra = false } = {}) {
  const n = frame.size * scale;
  const out = new Uint8Array(n * n * 4);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const key = frame.pixels[Math.floor(y / scale)][Math.floor(x / scale)];
    if (!key) continue;
    const [r, g, b] = hex(frame.palette[key]);
    const i = (y * n + x) * 4;
    out[i] = bgra ? b : r; out[i + 1] = g; out[i + 2] = bgra ? r : b; out[i + 3] = 255;
  }
  return { width: n, height: n, data: out };
}

export function frameToAscii(frame) { return frame.pixels.map((r) => r.map((k) => k || '.').join('')).join('\n'); }
