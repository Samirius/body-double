// Pet renderer: draws the familiar, wanders along the strip, reacts to the
// companion's live events, and shows nudges in a speech bubble.
import { buildFrame, SIZE } from './sprites.js';
import { petStage } from '../core/game.js';
import { decidePose, createWanderer } from './behaviour.js';

const SCALE = 4, SPR = SIZE * SCALE, GROUND = 6;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const bubble = document.getElementById('bubble');
const $ = (id) => document.getElementById(id);

const state = { label: null, paused: false, stage: 1, cheerUntil: 0, bubbleUntil: 0, connected: true };
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
  if (talking) placeBubble();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- speech bubble -------------------------------------------------------
function placeBubble() {
  const w = 320;
  const left = Math.max(8, Math.min(innerWidth - w - 8, wander.x() + SPR / 2 - 60));
  bubble.style.left = `${left}px`;
  bubble.style.bottom = `${SPR + GROUND + 18}px`;
  bubble.style.setProperty('--tail', `${Math.max(16, Math.min(w - 30, wander.x() + SPR / 2 - left - 9))}px`);
}
function showBubble({ message, nextAction, kind = 'drift' }) {
  $('msg').textContent = message || '';
  $('next').textContent = nextAction || '';
  // Only drift nudges can be "wrong"; day summaries and stuck offers get OK.
  const drift = kind === 'drift';
  $('b-wrong').style.display = drift ? '' : 'none';
  $('b-snooze').style.display = kind === 'evening' ? 'none' : '';
  $('b-ok').style.display = drift ? 'none' : '';
  bubble.style.display = 'block';
  state.bubbleUntil = performance.now() + 90_000;
  placeBubble();
}
function hideBubble() { bubble.style.display = 'none'; state.bubbleUntil = 0; }

async function act(name, payload) {
  const r = await window.bd.act(name, payload);
  if (!r.ok) floater(r.error, 'good');
  return r;
}
$('b-done').onclick = async () => { hideBubble(); const r = await act('done'); if (r.ok && !r.data.events.length) floater('No open step', 'good'); };
$('b-ok').onclick = () => hideBubble();
$('b-snooze').onclick = async () => { hideBubble(); await act('snooze', { minutes: 10 }); floater('Snoozed 10 min', 'good'); };
$('b-wrong').onclick = async () => {
  hideBubble();
  const r = await act('wrong');
  if (r.ok) floater(r.data.learned ? `Got it: "${r.data.keyword}" is fine here` : 'Noted', 'good');
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
  el.style.left = `${Math.max(8, Math.min(innerWidth - 260, wander.x() + SPR / 2 - 40))}px`;
  el.style.bottom = `${SPR + GROUND + 10 + slot * 30}px`;
  el.style.animationDelay = `${slot * 120}ms`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// --- click-through: interactive only over the pet or the bubble -------------
let interactive = false;
addEventListener('mousemove', (e) => {
  const px = wander.x(), py = canvas.height - SPR - GROUND;
  const overPet = e.clientX >= px + 8 && e.clientX <= px + SPR - 8 && e.clientY >= py + 16 && e.clientY <= py + SPR;
  const b = bubble.style.display === 'block' ? bubble.getBoundingClientRect() : null;
  const overBubble = !!b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  const want = overPet || overBubble;
  if (want !== interactive) { interactive = want; window.bd.setInteractive(want); document.body.style.cursor = overPet ? 'pointer' : 'default'; }
});
canvas.addEventListener('click', (e) => {
  const px = wander.x();
  if (e.clientX >= px && e.clientX <= px + SPR) act('panel');
});

// --- live events -----------------------------------------------------------
async function refreshStatus() {
  const r = await window.bd.act('status');
  if (!r.ok) return;
  state.paused = r.data.paused;
  if (r.data.label) state.label = r.data.label;
  state.stage = petStage(r.data.level.level);
}

window.bd.onConnection((s) => { state.connected = s === 'connected'; $('offline').style.display = state.connected ? 'none' : 'block'; if (state.connected) refreshStatus(); });
window.bd.onEvent((ev) => {
  if (ev.type === 'hello') { state.paused = ev.status.paused; state.label = ev.status.label; state.stage = petStage(ev.status.level.level); return; }
  if (ev.type === 'status') { if (ev.label) state.label = ev.label; if (typeof ev.paused === 'boolean') state.paused = ev.paused; return; }
  if (ev.type === 'nudge') { showBubble(ev); return; }
  if (ev.type !== 'game' || !ev.game) return;
  const g = ev.game;
  const cheer = (ms) => { state.cheerUntil = Math.max(state.cheerUntil, performance.now() + ms); };
  switch (g.type) {
    case 'xp': floater(`+${g.amount} XP · ${g.skill}`); cheer(1800); break;
    case 'comeback-bonus': floater('Comeback bonus ×1.5', 'good'); break;
    case 'level-up': floater(`LEVEL ${g.level}!`, 'big'); cheer(3000); break;
    case 'skill-up': floater(`${g.skill} → level ${g.level}`, 'good'); break;
    case 'title': floater(`New title: ${g.name}`, 'big'); cheer(2500); break;
    case 'boss-defeated': floater('BOSS DEFEATED!', 'big'); cheer(4000); break;
    case 'pet-evolved': state.stage = g.stage; floater('Your familiar evolved!', 'big'); cheer(4000); break;
    case 'shield-used': floater('Streak shield used', 'good'); break;
    case 'returned': floater('Welcome back', 'good'); cheer(1500); hideBubble(); break;
    default: break;
  }
  refreshStatus();
});
refreshStatus();
