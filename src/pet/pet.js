// Pet renderer: draws the familiar, wanders along the strip, reacts to the
// companion's live events, and shows nudges as an incoming transmission.
import { buildFrame, SIZE, STAGE_GLOW } from './sprites.js';
import { petStage } from '../core/game.js';
import { decidePose, createWanderer } from './behaviour.js';
import { createFeelings } from './feelings.js';
import { drawEmote, EMOTES } from './emotes.js';
import { play, setVolume } from './voice.js';

const SCALE = 4, SPR = SIZE * SCALE, GROUND = 6, BUBBLE_W = 340;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const bubble = document.getElementById('bubble');
const $ = (id) => document.getElementById(id);

const state = { label: null, paused: false, stage: 1, cheerUntil: 0, bubbleUntil: 0, connected: true, session: null };
const wander = createWanderer({ width: () => innerWidth, sprite: SPR });
// Recording the demo clips: stay in one spot so the crop keeps the creature.
const HOLD = new URLSearchParams(location.search).has('hold');
const QUIET = new URLSearchParams(location.search).has('quiet'); // self-test: no sound
if (QUIET) window.__petX = () => wander.x(); // lets the self-test check a real drag

// --- feelings: emotes, robot sounds, full-screen effects ---------------------
// SOUND, FX and volume are settings in the service (creature menu, HUD, agents).
const prefs = { sound: true, fx: true };
function applySettings(s) { if (!s) return; prefs.sound = s.sound !== false; prefs.fx = s.fx !== false; setVolume(s.volume ?? 60); showPrefs(); }
const feelings = createFeelings();
function react(r) {
  if (!r) return;
  if (r.emote) state.emote = { name: r.emote, until: performance.now() + 2800 };
  // Nothing loud while paused, in a call or presenting, or over a fullscreen app.
  const calm = state.paused || state.quiet || state.fullscreen;
  const sound = prefs.sound && !QUIET && !calm;
  if (r.voice && sound) play(r.voice);
  if (r.fx && prefs.fx && !calm) window.bd.fx({ ...r.fx, x: wander.x() + SPR / 2, sound });
}
// Flow combo: an aura behind the creature that grows (cyan, then gold at 30 min)
// and a small "FLOW xN" tag beside it.
function drawFlow(now) {
  const lv = state.flow?.level || 0;
  if (!lv) return;
  const cx = wander.x() + SPR / 2, cy = canvas.height - SPR / 2 - GROUND;
  const gold = lv >= 6, color = gold ? '255, 210, 58' : '0, 240, 255';
  const r = SPR * (0.55 + Math.min(lv, 8) * 0.05) + Math.sin(now / 400) * 3;
  const g = ctx.createRadialGradient(cx, cy, SPR * 0.2, cx, cy, r);
  g.addColorStop(0, `rgba(${color}, ${Math.min(0.12 + lv * 0.05, 0.45)})`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.font = '700 12px "Cascadia Mono", Consolas, monospace'; ctx.textAlign = 'right';
  ctx.fillStyle = `rgb(${color})`; ctx.shadowColor = `rgb(${color})`; ctx.shadowBlur = 8;
  // Outside the focus ring's radius, on whichever side has room.
  const gap = SPR * 0.66 + 10, right = cx - gap > 80;
  ctx.textAlign = right ? 'right' : 'left';
  ctx.fillText(`FLOW ×${lv}`, right ? cx - gap : cx + gap, cy + 4);
  ctx.restore();
}
function drawFeeling(now) {
  const e = state.emote;
  if (!e || now > e.until || !EMOTES[e.name]) return;
  // By the head, on the side with room; a small hop when it appears.
  const px = 4, w = EMOTES[e.name][0].length * px;
  const left = wander.x() + SPR - 6 + w > innerWidth;
  const x = left ? wander.x() - w + 6 : wander.x() + SPR - 6;
  const age = (now - (e.until - 2800)) / 1000;
  const y = canvas.height - SPR - GROUND + 26 - Math.max(0, 8 - age * 40) - Math.sin(age * 6) * 2;
  drawEmote(ctx, e.name, x, y, px);
}

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
  wander.step(dt, { canMove: !HOLD && (pose === 'idle' || pose === 'walk' || pose === 'worry') });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawFlow(now);
  draw(buildFrame({ state: pose, t, stage: state.stage, facing: wander.facing(), wear: state.wear }), wander.x(), canvas.height - SPR - GROUND);
  drawFeeling(now);
  // Walking right up to the screen edge: "whoaaa".
  if (wander.moving() && (wander.x() <= 30 || wander.x() >= innerWidth - SPR - 30)) react(feelings.edge());
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
$('m-quest').onclick = () => { toggleMenu(false); askQuest(); };
const showPrefs = () => { $('m-sound').textContent = `SOUND ${prefs.sound ? 'ON' : 'OFF'}`; $('m-fx').textContent = `FX ${prefs.fx ? 'ON' : 'OFF'}`; };
$('m-sound').onclick = async () => { const r = await act('settings', { sound: !prefs.sound }); if (r.ok) { applySettings(r.data); if (prefs.sound && !QUIET) play('happy'); } };
$('m-fx').onclick = async () => { const r = await act('settings', { fx: !prefs.fx }); if (r.ok) applySettings(r.data); };
showPrefs();

// --- transmission bubble ---------------------------------------------------
const KIND = {
  drift: { title: 'INCOMING // NUDGLING', accent: '#ff2bd6' },
  chat: { title: 'SIGNAL // OFF-QUEST CHAT', accent: '#ff2bd6' },
  stuck: { title: 'ASSIST // STEP TOO BIG?', accent: '#f5ff3b' },
  morning: { title: 'BOOT // TODAY’S RUN', accent: '#00f0ff' },
  ask: { title: 'NUDGLING // ONLINE', accent: '#39ff9a' },
  plan: { title: 'QUEST // ACCEPTED', accent: '#39ff9a' },
  'session-start': { title: 'SESSION // ENGAGED', accent: '#00f0ff' },
  'session-end': { title: 'SESSION // COMPLETE', accent: '#39ff9a' },
  'break-end': { title: 'BREAK // OVER', accent: '#00f0ff' },
  evening: { title: 'LOG // RUN COMPLETE', accent: '#39ff9a' },
  hyperfocus: { title: 'VITALS // REFILL', accent: '#f5ff3b' },
  scope: { title: 'SCOPE // GROWING', accent: '#f5ff3b' },
  'side-task': { title: 'SCOPE // SIDE TASK?', accent: '#f5ff3b' },
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
  // Scope moments: park the new thing; a side task can also be "part of it".
  const scope = kind === 'scope' || kind === 'side-task';
  state.bubbleKind = kind;
  $('b-wrong').style.display = drift || kind === 'side-task' ? '' : 'none';
  $('b-wrong').textContent = kind === 'side-task' ? 'Part of it' : 'Wrong';
  $('b-park').style.display = drift || scope ? '' : 'none';
  // Questions and plan confirmations only need OK / Later.
  const plain = kind === 'ask' || kind === 'plan';
  $('b-snooze').style.display = kind === 'evening' || plain || scope ? 'none' : '';
  $('b-done').style.display = plain ? 'none' : '';
  $('b-ok').style.display = drift || kind === 'side-task' ? 'none' : '';
  $('b-ok').textContent = kind === 'ask' ? 'Later' : 'OK';
  $('ask').style.display = kind === 'ask' ? 'flex' : 'none';
  window.bd.setTyping(kind === 'ask');
  bubble.style.display = 'none';
  void bubble.offsetWidth; // restart the boot animation
  bubble.style.display = 'block';
  state.bubbleUntil = performance.now() + 90_000;
  placeBubble();
}
function hideBubble() { bubble.style.display = 'none'; state.bubbleUntil = 0; clearInterval(typing); if ($('ask').style.display !== 'none') { $('ask').style.display = 'none'; window.bd.setTyping(false); } }

// --- the question: "what are you working on?" (first run, or QUEST in the menu)
function askQuest() {
  showBubble({ message: 'What are you working on right now?', nextAction: 'One thing. I\'ll split it into tiny steps.', kind: 'ask' });
  react(feelings.nudge('ask'));
  $('ask-in').value = '';
  setTimeout(() => $('ask-in').focus(), 50);
}
$('ask').onsubmit = async (e) => {
  e.preventDefault();
  const title = $('ask-in').value.trim();
  if (!title) return;
  hideBubble();
  await act('quick-quest', { title });
};
$('ask-in').onkeydown = (e) => { if (e.key === 'Escape') hideBubble(); };

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
  if (r.ok) { floater('PARKED // IN VAULT', 'warn'); react(feelings.park()); }
};
$('b-wrong').onclick = async () => {
  hideBubble();
  if (state.bubbleKind === 'side-task') {
    const s = await act('scope-allow');
    if (s.ok) floater(`LEARNED // "${s.data.allowed}" IS PART OF IT`, 'good');
    return;
  }
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
// Drag the creature along the bottom of the screen; a press without moving is a click (menu).
let drag = null; // { offset, startX, moved }
canvas.addEventListener('mousedown', (e) => {
  const px = wander.x();
  if (e.button !== 0 || e.clientX < px || e.clientX > px + SPR) return;
  drag = { offset: e.clientX - px, startX: e.clientX, moved: false };
  document.body.style.cursor = 'grabbing';
});
addEventListener('mouseup', (e) => {
  if (!drag) return;
  const wasClick = !drag.moved;
  drag = null;
  document.body.style.cursor = 'grab';
  if (wasClick) toggleMenu();
  else react({ emote: 'heart', voice: 'ooh' });
});
addEventListener('mousemove', (e) => {
  if (drag) {
    if (Math.abs(e.clientX - drag.startX) > 4) drag.moved = true;
    if (drag.moved) wander.place(Math.max(0, Math.min(innerWidth - SPR, e.clientX - drag.offset)));
    return; // stay interactive while dragging
  }
  const px = wander.x(), py = canvas.height - SPR - GROUND;
  const overPet = e.clientX >= px + 8 && e.clientX <= px + SPR - 8 && e.clientY >= py + 16 && e.clientY <= py + SPR;
  const b = bubble.style.display === 'block' ? bubble.getBoundingClientRect() : null;
  const overBubble = !!b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  const m = menu.style.display === 'flex' ? menu.getBoundingClientRect() : null;
  const overMenu = !!m && e.clientX >= m.left && e.clientX <= m.right && e.clientY >= m.top && e.clientY <= m.bottom;
  const want = overPet || overBubble || overMenu;
  if (want !== interactive) { interactive = want; window.bd.setInteractive(want); document.body.style.cursor = overPet ? 'grab' : 'default'; }
});

// --- live events -----------------------------------------------------------
async function refreshStatus() {
  const r = await window.bd.act('status');
  if (!r.ok) return;
  state.paused = r.data.paused;
  if (r.data.label) state.label = r.data.label;
  state.stage = petStage(r.data.level.level);
  state.session = r.data.session || null;
  state.flow = r.data.flow || null;
  applySettings(r.data.settings);
  state.wear = r.data.rewards?.equipped || null;
  state.quiet = !!r.data.quiet; state.fullscreen = !!r.data.fullscreen;
  applyGlow();
  // First run (or every quest finished): ask once per launch instead of nudging about nothing.
  if (!r.data.quest && !state.asked) { state.asked = true; askQuest(); }
}

window.bd.onConnection((s) => { state.connected = s === 'connected'; $('offline').style.display = state.connected ? 'none' : 'block'; if (state.connected) refreshStatus(); });
window.bd.onEvent((ev) => {
  if (ev.type === 'hello') { state.paused = ev.status.paused; state.label = ev.status.label; state.stage = petStage(ev.status.level.level); applyGlow(); return; }
  if (ev.type === 'status') {
    if ('session' in ev) state.session = ev.session;
    if (ev.label) state.label = ev.label;
    // A snooze (from the bubble, the HUD or Claude): a sigh, or on the 3rd in an hour, the big "I'M NOT MAD".
    if (ev.paused === true && ev.pausedUntil && !state.paused) { state.paused = false; react(feelings.snooze()); }
    if (typeof ev.paused === 'boolean') state.paused = ev.paused;
    if (typeof ev.quiet === 'boolean') state.quiet = ev.quiet;
    if (typeof ev.fullscreen === 'boolean') state.fullscreen = ev.fullscreen;
    if (ev.flow) state.flow = ev.flow;
    if (ev.settings) applySettings(ev.settings);
    if (ev.rewards) state.wear = ev.rewards.equipped || null;
    applyGlow();
    return;
  }
  if (ev.type === 'nudge') { showBubble(ev); react(feelings.nudge(ev.kind || 'drift', { next: ev.nextAction })); return; }
  if (ev.type !== 'game' || !ev.game) return;
  const g = ev.game;
  const cheer = (ms) => { state.cheerUntil = Math.max(state.cheerUntil, performance.now() + ms); };
  switch (g.type) {
    case 'xp': floater(`+${g.amount} XP // ${String(g.skill).toUpperCase()}`); cheer(1800); react(feelings.done()); break;
    case 'comeback-bonus': floater('COMEBACK ×1.5', 'good'); break;
    case 'level-up': floater(`LEVEL UP // ${String(g.level).padStart(2, '0')}`, 'big'); cheer(3000); react(feelings.celebrate('level-up', String(g.level).padStart(2, '0'))); break;
    case 'skill-up': floater(`${String(g.skill).toUpperCase()} → LV ${g.level}`, 'good'); break;
    case 'title': floater(`TITLE UNLOCKED // ${String(g.name).toUpperCase()}`, 'big'); cheer(2500); break;
    case 'boss-defeated': floater('BOSS DOWN', 'big'); cheer(4000); react(feelings.celebrate('boss-defeated', g.quest || '')); break;
    case 'pet-evolved': state.stage = g.stage; floater('NUDGLING EVOLVED', 'big'); cheer(4000); react(feelings.celebrate('pet-evolved')); break;
    case 'shield-used': floater('STREAK SHIELD USED', 'good'); break;
    case 'returned': {
      const r = feelings.returned(g.secondsAfterNudge);
      floater(r.quick ? `QUICK RETURN // ${g.secondsAfterNudge}S` : 'BACK ON QUEST', r.quick ? 'big' : 'good');
      cheer(r.quick ? 2500 : 1500); hideBubble(); react(r);
      break;
    }
    case 'session-done': floater(`SESSION COMPLETE // ${g.minutes} MIN`, 'big'); cheer(3000); break;
    case 'perfect-session': react(feelings.perfect(g.minutes)); break;
    case 'achievement': floater(`ACHIEVEMENT // ${String(g.name).toUpperCase()}`, 'big'); cheer(3000); react(feelings.achievement(g.name, g.unlocks)); break;
    case 'flow': state.flow = { level: g.level, minutes: g.minutes }; if (g.level === 1 || g.level % 6 === 0) floater(`FLOW ×${g.level} // ${g.minutes} MIN`, 'good'); react(feelings.flow(g.level)); break;
    case 'flow-banked': state.flow = null; floater(`FLOW BANKED // ${g.minutes} MIN`, 'good'); break;
    case 'parked': break; // the Park button already confirmed it
    default: break;
  }
  refreshStatus();
});
refreshStatus();
