// Pet renderer: draws the familiar, wanders along the strip, reacts to the
// companion's live events, and shows nudges as an incoming transmission.
import { buildFrame, SIZE, STAGE_GLOW } from './sprites.js';
import { petStage } from '../core/game.js';
import { decidePose, createWanderer } from './behaviour.js';

const SCALE = 4, SPR = SIZE * SCALE, GROUND = 6, BUBBLE_W = 340;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const bubble = document.getElementById('bubble');
const $ = (id) => document.getElementById(id);

const state = { label: null, paused: false, stage: 1, cheerUntil: 0, bubbleUntil: 0, connected: true, session: null };
const wander = createWanderer({ width: () => innerWidth, sprite: SPR });

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; ctx.imageSmoothingEnabled = false; }
addEventListener('resize', resize);
resize();

function draw(frame, x, y) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const k = frame.pixels[r][c];
    if (!k) continue;
    ctx.fillStyle = frame.palette[k];
    ctx.fillRect(Math.round(x + c * SCALE), Math.round(y + r * SCALE), SCALE, SCALE);
  }
}

// The glow follows the familiar's stage, and turns red while you drift.
function applyGlow() {
  const glow = state.label === 'drift' ? '#ff3b5c' : STAGE_GLOW[state.stage] || STAGE_GLOW[1];
  canvas.style.setProperty('--glow', glow);
}

let last = performance.now();
function loop(now) {
  const t = now / 1000, dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const talking = now < state.bubbleUntil;
  if (!talking && bubble.style.display === 'block') hideBubble();
  const pose = decidePose({ now, cheerUntil: state.cheerUntil, talking, label: state.label, paused: state.paused, moving: wander.moving() });
  wander.step(dt, { canMove: pose === 'idle' || pose === 'walk' || pose === 'worry' });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  draw(buildFrame({ state: pose, t, stage: state.stage, facing: wander.facing() }), wander.x(), canvas.height - SPR - GROUND);
  drawRing(Date.now());
  if (talking) placeBubble();
  if (menu.style.display === 'flex') placeMenu();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- timer ring (focus session / break) -------------------------------------
function drawRing(nowMs) {
  const s = state.session;
  if (!s) return;
  const total = s.endAt - s.startAt, left = Math.max(0, s.endAt - nowMs);
  const r = SPR * 0.62, cx = wander.x() + SPR / 2, cy = canvas.height - r - 4; // whole ring stays inside the strip
  const color = s.kind === 'break' ? '#39ff9a' : '#00f0ff';
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(40, 44, 90, .55)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  // Segmented arc for the time that is left, draining clockwise from the top.
  ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.setLineDash([9, 3]);
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total); ctx.stroke();
  ctx.setLineDash([]); ctx.shadowBlur = 6;
  const mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  ctx.font = '700 13px "Cascadia Mono", Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color;
  ctx.fillText(`${s.kind === 'break' ? 'BREAK' : 'FOCUS'} ${mm}:${ss}`, cx, cy - r - 8);
  ctx.restore();
}

// --- quick menu at the pet ---------------------------------------------------
const menu = $('menu');
function placeMenu() {
  const w = menu.offsetWidth || 300;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, wander.x() + SPR / 2 - w / 2))}px`;
  menu.style.bottom = `${SPR + GROUND + 34}px`;
}
function toggleMenu(show = menu.style.display !== 'flex') {
  $('m-stop').style.display = state.session ? '' : 'none';
  menu.style.display = show ? 'flex' : 'none';
  if (show) placeMenu();
}
menu.querySelectorAll('button[data-min]').forEach((b) => { b.onclick = async () => { toggleMenu(false); await act('session', { minutes: Number(b.dataset.min) }); refreshStatus(); }; });
$('m-stop').onclick = async () => { toggleMenu(false); await act('session', { action: 'stop' }); refreshStatus(); };
$('m-hud').onclick = () => { toggleMenu(false); act('panel'); };

// --- transmission bubble ---------------------------------------------------
const KIND = {
  drift: { title: 'INCOMING // NUDGLING', accent: '#ff2bd6' },
  chat: { title: 'SIGNAL // OFF-QUEST CHAT', accent: '#ff2bd6' },
  stuck: { title: 'ASSIST // STEP TOO BIG?', accent: '#f5ff3b' },
  morning: { title: 'BOOT // TODAY’S RUN', accent: '#00f0ff' },
  'session-start': { title: 'SESSION // ENGAGED', accent: '#00f0ff' },
  'session-end': { title: 'SESSION // COMPLETE', accent: '#39ff9a' },
  'break-end': { title: 'BREAK // OVER', accent: '#00f0ff' },
  evening: { title: 'LOG // RUN COMPLETE', accent: '#39ff9a' },
};
function placeBubble() {
  const left = Math.max(8, Math.min(innerWidth - BUBBLE_W - 8, wander.x() + SPR / 2 - 70));
  bubble.style.left = `${left}px`;
  bubble.style.bottom = `${SPR + GROUND + 18}px`;
  bubble.style.setProperty('--tail', `${Math.max(18, Math.min(BUBBLE_W - 32, wander.x() + SPR / 2 - left - 7))}px`);
}
let typing = null;
function typeOut(el, text) {
  clearInterval(typing);
  el.textContent = '';
  let i = 0;
  typing = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typing); }, 14);
}
function showBubble({ message, nextAction, kind = 'drift' }) {
  const k = KIND[kind] || KIND.drift;
  bubble.style.setProperty('--accent', k.accent);
  $('b-title').textContent = k.title;
  typeOut($('msg'), message || '');
  $('next').textContent = nextAction || '';
  // Drift-type nudges can be parked or marked wrong; summaries and offers get OK.
  const drift = kind === 'drift' || kind === 'chat';
  $('b-wrong').style.display = drift ? '' : 'none';
  $('b-park').style.display = drift ? '' : 'none';
  $('b-snooze').style.display = kind === 'evening' ? 'none' : '';
  $('b-ok').style.display = drift ? 'none' : '';
  bubble.style.display = 'none';
  void bubble.offsetWidth; // restart the boot animation
  bubble.style.display = 'block';
  state.bubbleUntil = performance.now() + 90_000;
  placeBubble();
}
function hideBubble() { bubble.style.display = 'none'; state.bubbleUntil = 0; clearInterval(typing); }

async function act(name, payload) {
  const r = await window.bd.act(name, payload);
  if (!r.ok) floater(r.error, 'warn');
  return r;
}
$('b-done').onclick = async () => { hideBubble(); const r = await act('done'); if (r.ok && !r.data.events.length) floater('NO OPEN STEP', 'warn'); };
$('b-ok').onclick = () => hideBubble();
$('b-snooze').onclick = async () => { hideBubble(); await act('snooze', { minutes: 10 }); floater('SNOOZE // 10 MIN', 'good'); };
$('b-park').onclick = async () => {
  hideBubble();
  const r = await act('park');
  if (r.ok) floater('PARKED // IN VAULT', 'warn');
};
$('b-wrong').onclick = async () => {
  hideBubble();
  const r = await act('wrong');
  if (r.ok) floater(r.data.learned ? `LEARNED // "${r.data.keyword}" OK HERE` : 'NOTED', 'good');
};

// --- floating text ---------------------------------------------------------
// Floaters that appear together stack upwards instead of overlapping.
let floaterSlot = 0, floaterSlotReset = 0;
function floater(text, kind = '') {
  const nowMs = performance.now();
  if (nowMs > floaterSlotReset) floaterSlot = 0;
  const slot = floaterSlot++;
  floaterSlotReset = nowMs + 700;
  const el = document.createElement('div');
  el.className = `floater ${kind}`;
  el.textContent = text;
  el.style.left = `${Math.max(8, Math.min(innerWidth - 320, wander.x() + SPR / 2 - 50))}px`;
  el.style.bottom = `${SPR + GROUND + 12 + slot * 34}px`;
  el.style.animationDelay = `${slot * 120}ms`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

// --- click-through: interactive only over the pet or the bubble -------------
let interactive = false;
addEventListener('mousemove', (e) => {
  const px = wander.x(), py = canvas.height - SPR - GROUND;
  const overPet = e.clientX >= px + 8 && e.clientX <= px + SPR - 8 && e.clientY >= py + 16 && e.clientY <= py + SPR;
  const b = bubble.style.display === 'block' ? bubble.getBoundingClientRect() : null;
  const overBubble = !!b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  const m = menu.style.display === 'flex' ? menu.getBoundingClientRect() : null;
  const overMenu = !!m && e.clientX >= m.left && e.clientX <= m.right && e.clientY >= m.top && e.clientY <= m.bottom;
  const want = overPet || overBubble || overMenu;
  if (want !== interactive) { interactive = want; window.bd.setInteractive(want); document.body.style.cursor = overPet ? 'pointer' : 'default'; }
});
canvas.addEventListener('click', (e) => {
  const px = wander.x();
  if (e.clientX >= px && e.clientX <= px + SPR) toggleMenu();
});

// --- live events -----------------------------------------------------------
async function refreshStatus() {
  const r = await window.bd.act('status');
  if (!r.ok) return;
  state.paused = r.data.paused;
  if (r.data.label) state.label = r.data.label;
  state.stage = petStage(r.data.level.level);
  state.session = r.data.session || null;
  applyGlow();
}

window.bd.onConnection((s) => { state.connected = s === 'connected'; $('offline').style.display = state.connected ? 'none' : 'block'; if (state.connected) refreshStatus(); });
window.bd.onEvent((ev) => {
  if (ev.type === 'hello') { state.paused = ev.status.paused; state.label = ev.status.label; state.stage = petStage(ev.status.level.level); applyGlow(); return; }
  if (ev.type === 'status') { if ('session' in ev) state.session = ev.session; if (ev.label) state.label = ev.label; if (typeof ev.paused === 'boolean') state.paused = ev.paused; applyGlow(); return; }
  if (ev.type === 'nudge') { showBubble(ev); return; }
  if (ev.type !== 'game' || !ev.game) return;
  const g = ev.game;
  const cheer = (ms) => { state.cheerUntil = Math.max(state.cheerUntil, performance.now() + ms); };
  switch (g.type) {
    case 'xp': floater(`+${g.amount} XP // ${String(g.skill).toUpperCase()}`); cheer(1800); break;
    case 'comeback-bonus': floater('COMEBACK ×1.5', 'good'); break;
    case 'level-up': floater(`LEVEL UP // ${String(g.level).padStart(2, '0')}`, 'big'); cheer(3000); break;
    case 'skill-up': floater(`${String(g.skill).toUpperCase()} → LV ${g.level}`, 'good'); break;
    case 'title': floater(`TITLE UNLOCKED // ${String(g.name).toUpperCase()}`, 'big'); cheer(2500); break;
    case 'boss-defeated': floater('BOSS DOWN', 'big'); cheer(4000); break;
    case 'pet-evolved': state.stage = g.stage; floater('NUDGLING EVOLVED', 'big'); cheer(4000); break;
    case 'shield-used': floater('STREAK SHIELD USED', 'good'); break;
    case 'returned': floater('BACK ON QUEST', 'good'); cheer(1500); hideBubble(); break;
    case 'session-done': floater(`SESSION COMPLETE // ${g.minutes} MIN`, 'big'); cheer(3000); break;
    case 'parked': break; // the Park button already confirmed it
    default: break;
  }
  refreshStatus();
});
refreshStatus();
