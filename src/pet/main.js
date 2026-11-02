// Desktop pet: Electron main process.
//  - pet strip: transparent, always-on-top window along the bottom of the work
//    area; click-through except where the renderer reports the pet or bubble
//  - panel: quest, XP, skills, boss HP, streak, titles, actions
//  - tray icon + global hotkeys (Ctrl+Alt+D done, Ctrl+Alt+P pause, Ctrl+Alt+B panel)
//  - talks to the background service through src/client.js (starts it if needed)
//   npm run pet                     run
//   npm run pet -- --selftest <dir> render, screenshot both windows, quit
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell } from 'electron';
import { connectClaude, claudeConnected } from '../claude-connect.js';
import path from 'node:path';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '../client.js';
import { buildFrame, frameToBitmap } from './sprites.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const selftestIdx = process.argv.indexOf('--selftest');
const SELFTEST_DIR = selftestIdx > 0 ? path.resolve(process.argv[selftestIdx + 1] || 'selftest-out') : null;
// The self-test adds quests and finishes steps: never against real data.
if (SELFTEST_DIR && !process.env.BD_DATA_DIR) { console.error('--selftest needs BD_DATA_DIR (a throwaway data folder); use npm run test:pet'); process.exit(2); }
// --record (with --selftest): also save short frame sequences for the demo video.
const RECORD = !!SELFTEST_DIR && process.argv.includes('--record');
const STRIP_HEIGHT = 330; // room for the transmission bubble above the pet

if (!SELFTEST_DIR && !app.requestSingleInstanceLock()) app.quit();

const client = createClient({ env: process.env, nodePath: process.execPath });
let pet = null, panel = null, fx = null, tray = null, unsubscribe = null, connected = false;
const send = (channel, payload) => { for (const w of [pet, panel]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload); };

// Which screen the creature lives on (tray: "Move to next screen"); remembered
// by display id, back to the primary screen if that one is unplugged.
const displayFile = () => path.join(app.getPath('userData'), 'display.json');
function homeDisplay() {
  let id = null;
  try { id = JSON.parse(readFileSync(displayFile(), 'utf8')).id; } catch { /* first run */ }
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}
function placeOn(display) {
  const a = display.workArea;
  pet?.setBounds({ x: a.x, y: a.y + a.height - STRIP_HEIGHT, width: a.width, height: STRIP_HEIGHT });
  fx?.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height });
  panel?.setPosition(a.x + a.width - 380, a.y + a.height - STRIP_HEIGHT - 560 + 120);
}
function nextScreen() {
  const all = screen.getAllDisplays(), cur = homeDisplay();
  const next = all[(all.findIndex((d) => d.id === cur.id) + 1) % all.length];
  try { writeFileSync(displayFile(), JSON.stringify({ id: next.id })); } catch { /* not remembered */ }
  placeOn(next);
}

function createPet() {
  const area = homeDisplay().workArea;
  pet = new BrowserWindow({
    x: area.x, y: area.y + area.height - STRIP_HEIGHT, width: area.width, height: STRIP_HEIGHT,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false, skipTaskbar: true,
    focusable: false, alwaysOnTop: true, backgroundColor: '#00000000', show: false,
    // Its little robot sounds play without a click first.
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  pet.setAlwaysOnTop(true, 'floating');
  pet.setIgnoreMouseEvents(true, { forward: true });
  // The self-test stays silent; recording also holds the creature in place.
  pet.loadFile(path.join(here, 'pet.html'), { query: { ...(RECORD ? { hold: '1' } : {}), ...(SELFTEST_DIR ? { quiet: '1' } : {}) } });
  pet.once('ready-to-show', () => pet.showInactive());
}

// Full-screen effects (bomb, rage text, confetti): a transparent window over
// the work area that never takes clicks or focus and is shown only while an
// effect plays.
function createFx() {
  const area = homeDisplay().workArea;
  fx = new BrowserWindow({
    x: area.x, y: area.y, width: area.width, height: area.height,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false, skipTaskbar: true,
    focusable: false, alwaysOnTop: true, backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  fx.setAlwaysOnTop(true, 'screen-saver');
  fx.setIgnoreMouseEvents(true);
  fx.loadFile(path.join(here, 'fx.html'));
}

function createPanel() {
  const area = homeDisplay().workArea;
  panel = new BrowserWindow({
    width: 360, height: 560, x: area.x + area.width - 380, y: area.y + area.height - STRIP_HEIGHT - 560 + 120,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#0f172a',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  panel.loadFile(path.join(here, 'panel.html'));
  panel.on('blur', () => { if (!SELFTEST_DIR) panel.hide(); });
}

const togglePanel = () => { if (panel.isVisible()) panel.hide(); else { panel.show(); panel.webContents.send('bd:refresh'); } };

function createTray() {
  const bmp = frameToBitmap(buildFrame({ state: 'idle', stage: 1 }), 1, { bgra: true });
  tray = new Tray(nativeImage.createFromBitmap(Buffer.from(bmp.data), { width: bmp.width, height: bmp.height }));
  tray.setToolTip('Nudgling');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show panel', click: togglePanel },
    { label: 'Mark next step done', click: () => act('done') },
    { label: 'Pause / resume', click: () => act('pause-toggle') },
    { label: 'Snooze 10 minutes', click: () => act('snooze', { minutes: 10 }) },
    { label: 'Open stats page', click: () => act('stats').catch(() => {}) },
    { label: 'Move to next screen', click: nextScreen },
    { type: 'separator' },
    { label: 'Quit pet (service keeps running)', click: () => app.quit() },
  ]));
  tray.on('click', togglePanel);
}

// Every renderer action goes through this allowlist; nothing else is reachable.
async function act(name, payload = {}) {
  switch (name) {
    case 'status': return client.call('GET', '/status');
    case 'quests': return client.call('GET', '/quests');
    case 'done': return client.call('POST', '/steps/done');
    case 'wrong': return client.call('POST', '/feedback', { verdict: 'wrong-nudge' });
    case 'park': return client.call('POST', '/vault/park', {});
    case 'session': return client.call('POST', '/session', { action: payload.action === 'stop' ? 'stop' : 'start', minutes: Number(payload.minutes) || 25 });
    case 'vault': return client.call('GET', '/vault');
    case 'unpark': return client.call('POST', '/vault/remove', { id: String(payload.id || '') });
    case 'missed': return client.call('POST', '/feedback', { verdict: 'missed-drift' });
    case 'snooze': return client.call('POST', '/pause', { paused: true, minutes: payload.minutes || 10 });
    case 'pause-toggle': { const s = await client.call('GET', '/status'); return client.call('POST', '/pause', { paused: !s.paused }); }
    case 'activate': return client.call('POST', '/quests/activate', { query: String(payload.query || '') });
    case 'quest-rename': return client.call('POST', '/quests/edit', { query: String(payload.query || ''), patch: { title: String(payload.title || '').slice(0, 120) } });
    case 'quest-remove': return client.call('POST', '/quests/remove', { query: String(payload.query || '') });
    case 'settings': return client.call('POST', '/settings', payload || {});
    case 'get-settings': return client.call('GET', '/settings');
    case 'rewards': return client.call('GET', '/rewards');
    case 'equip': return client.call('POST', '/rewards/equip', { item: payload.item ?? null });
    case 'week': return client.call('GET', '/week');
    case 'scope-allow': return client.call('POST', '/scope/allow', {});
    case 'import': return client.call('POST', '/import/jarvis', {});
    case 'add-quest': {
      // Validate here too: the renderer is UI, not a trust boundary.
      const str = (v, n) => String(v ?? '').trim().slice(0, n);
      const title = str(payload.title, 120);
      if (!title) throw new Error('a quest needs a title');
      const steps = (Array.isArray(payload.steps) ? payload.steps : []).map((s) => str(s, 120)).filter(Boolean).slice(0, 20);
      const allow = (Array.isArray(payload.allow) ? payload.allow : []).map((s) => str(s, 40).toLowerCase()).filter(Boolean).slice(0, 10);
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.deadline || '')) ? payload.deadline : undefined;
      return client.call('POST', '/quests', { title, steps, allow, deadline, tag: str(payload.tag, 30) || 'General' });
    }
    // First-run question in the bubble: name one thing, the brain plans it.
    case 'quick-quest': {
      const title = String(payload.title ?? '').trim().slice(0, 120);
      if (!title) throw new Error('a quest needs a title');
      const added = await client.call('POST', '/quests', { title, tag: 'General' });
      await client.call('POST', '/quests/plan', {});
      return added;
    }
    case 'panel': return togglePanel();
    // Only on a click in the HUD: the user asks for it; a backup is made first.
    case 'connect-claude': return connectClaude({ remove: claudeConnected() });
    case 'claude-status': return { connected: claudeConnected() };
    case 'meta-status': return client.call('GET', '/meta/status');
    case 'meta-logout': return client.call('POST', '/meta/logout', {});
    case 'meta-login': {
      const r = await client.call('POST', '/meta/login', {});
      // Open only Meta's own https page, never an arbitrary URL from a response.
      const u = new URL(r.verificationUri);
      if (u.protocol === 'https:' && /(^|\.)meta\.com$/.test(u.hostname)) await shell.openExternal(u.href);
      return r;
    }
    case 'stats': { const r = await client.call('GET', '/stats'); await shell.openPath(r.htmlPath); return r.totals; }
    default: throw new Error(`unknown action ${name}`);
  }
}

ipcMain.handle('bd:act', async (_e, name, payload) => {
  try { return { ok: true, data: await act(name, payload) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
const FX_KINDS = new Set(['bomb', 'rage', 'confetti', 'gold']);
ipcMain.on('bd:fx', (_e, p) => {
  if (!fx || fx.isDestroyed() || !FX_KINDS.has(p?.kind)) return;
  // The strip and this window share the work area's x, so the bomb starts at the creature.
  fx.showInactive();
  fx.webContents.send('bd:fx', { kind: p.kind, text: String(p.text || '').slice(0, 60), sub: String(p.sub || '').slice(0, 90), x: Number(p.x) || null, sound: !!p.sound });
});
ipcMain.on('bd:fx-done', () => { if (fx && !fx.isDestroyed()) fx.hide(); });
ipcMain.on('bd:interactive', (_e, on) => { if (pet && !pet.isDestroyed()) pet.setIgnoreMouseEvents(!on, { forward: true }); });
// The strip never takes focus (it must not steal typing), except while its
// question field is open.
ipcMain.on('bd:typing', (_e, on) => { if (!pet || pet.isDestroyed()) return; pet.setFocusable(!!on); if (on) pet.focus(); else pet.blur(); });

async function selftest() {
  const shot = async (win, name) => { const img = await win.webContents.capturePage(); writeFileSync(path.join(SELFTEST_DIR, `${name}.png`), img.toPNG()); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  mkdirSync(SELFTEST_DIR, { recursive: true });
  const report = { steps: [] };
  const step = (k, v) => report.steps.push({ [k]: v });
  // Frame sequence of the right-hand 640 px (bubble + creature) at ~15 fps while
  // `during` runs, then until `seconds` have passed. Off unless --record.
  // With { win: fx }: the whole effects window, halved.
  const clip = async (name, seconds, during = async () => {}, { win = pet } = {}) => {
    if (!RECORD) return during();
    const dir = path.join(SELFTEST_DIR, 'clips', name);
    mkdirSync(dir, { recursive: true });
    const { width, height } = win.getContentBounds();
    const rect = win === pet ? { x: width - 640, y: 0, width: 640, height } : { x: 0, y: 0, width, height };
    // A hidden window never paints, so capturing it would wait forever: blank frame instead.
    const blank = win === pet ? null : nativeImage.createFromBitmap(Buffer.alloc(Math.round(width / 2) * Math.round(height / 2) * 4), { width: Math.round(width / 2), height: Math.round(height / 2) }).toPNG();
    const grab = async () => {
      if (blank && !win.isVisible()) return blank;
      // It can also hide mid-capture: give up after a second.
      const img = await Promise.race([win.webContents.capturePage(rect), wait(1000).then(() => null)]);
      if (!img) return blank;
      return (win === pet ? img : img.resize({ width: Math.round(width / 2), height: Math.round(height / 2) })).toPNG();
    };
    let n = 0, recording = true;
    const started = Date.now();
    const loop = (async () => {
      while (recording || Date.now() - started < seconds * 1000) {
        const t0 = Date.now();
        writeFileSync(path.join(dir, `${String(n++).padStart(4, '0')}.png`), await grab());
        await wait(Math.max(0, 66 - (Date.now() - t0)));
      }
    })();
    await during();
    recording = false;
    await loop;
    report.clips = { ...report.clips, [name]: { frames: n, seconds: (Date.now() - started) / 1000 } };
  };
  const typeInto = async (text) => { for (let i = 1; i <= text.length; i++) { await pet.webContents.executeJavaScript(`document.getElementById('ask-in').value = ${JSON.stringify(text.slice(0, i))}; 0`); await wait(70); } };
  try {
    // Act only once the live event stream is up, as a person would.
    for (let i = 0; i < 80 && !connected; i++) await wait(250);
    if (!connected) throw new Error('event stream never connected');
    step('connected', true);
    // First run: no quest, so the creature asks. Answer it through the real form.
    const bubbleTitle = () => pet.webContents.executeJavaScript("document.getElementById('bubble').style.display === 'block' ? document.getElementById('b-title').textContent : null");
    for (let i = 0; i < 20 && (await bubbleTitle()) !== 'NUDGLING // ONLINE'; i++) await wait(250);
    if ((await bubbleTitle()) !== 'NUDGLING // ONLINE') throw new Error('first-run question did not appear');
    await wait(900);
    await shot(pet, '0-pet-ask');
    await clip('ask', 9, async () => {
      if (RECORD) await typeInto('Write the launch post');
      await pet.webContents.executeJavaScript("(() => { document.getElementById('ask-in').value = 'Write the launch post'; document.getElementById('ask').requestSubmit(); })()");
      for (let i = 0; i < 20 && (await bubbleTitle()) !== 'QUEST // ACCEPTED'; i++) await wait(250);
    });
    const afterAsk = await client.call('GET', '/status');
    step('asked', { quest: afterAsk.quest?.title, bubble: await bubbleTitle() });
    if (afterAsk.quest?.title !== 'Write the launch post') throw new Error('first-run answer did not become the quest');
    if ((await bubbleTitle()) !== 'QUEST // ACCEPTED') throw new Error('no plan after naming the quest');
    await wait(900);
    await shot(pet, '0-pet-plan');
    await client.call('POST', '/quests', { title: 'Banafah verification', steps: ['Add store hours in Merchant Center', 'Upload storefront photo', 'Request review'], tag: 'Client Work', deadline: '2026-11-06', allow: ['merchant center'] });
    step('quest', 'added');
    const done = await client.call('POST', '/steps/done');
    step('done', done.events.map((e) => e.type));
    await wait(1500);
    await shot(pet, '1-pet-cheer');
    // Demo clip: a drift nudge types itself out, then the real Done button.
    await clip('nudge', 13, async () => {
      if (!RECORD) return;
      await client.call('POST', '/debug/emit', { type: 'nudge', message: 'Quick check: "Banafah verification"?', nextAction: 'Upload storefront photo' });
      await wait(9500); // the narration describes the bubble for ~9 s
      await pet.webContents.executeJavaScript("document.getElementById('b-done').click()");
    });
    await client.call('POST', '/debug/emit', { type: 'nudge', message: 'Quick check: "Banafah verification"?', nextAction: 'Upload storefront photo' });
    await wait(1200);
    await shot(pet, '2-pet-nudge');
    // Press the bubble's real Snooze button: renderer -> IPC -> service.
    await pet.webContents.executeJavaScript("document.getElementById('b-snooze').click()");
    await wait(1500);
    const afterSnooze = await client.call('GET', '/status');
    step('snoozed', { paused: afterSnooze.paused, pausedUntil: afterSnooze.pausedUntil != null });
    if (!afterSnooze.paused) throw new Error('snooze button did not pause the service');
    await shot(pet, '3-pet-sleep');
    // Start a focus session through the pet's own quick menu.
    await client.call('POST', '/pause', { paused: false });
    // Demo clip: the creature's menu opens, FOCUS 25, the ring starts counting.
    await clip('ring', 9, async () => {
      // The pet's frame loop places the menu once it is visible.
      await pet.webContents.executeJavaScript("document.getElementById('menu').style.display = 'flex'; 0");
      if (RECORD) await wait(1500);
      await pet.webContents.executeJavaScript("document.querySelector('#menu button[data-min=\"25\"]').click()");
      await wait(1800);
      if (RECORD) { await wait(2500); await pet.webContents.executeJavaScript("document.getElementById('b-ok').click(); 0"); }
    });
    const afterSession = await client.call('GET', '/status');
    step('session', afterSession.session && { kind: afterSession.session.kind, minutes: afterSession.session.minutes });
    if (afterSession.session?.kind !== 'focus') throw new Error('menu did not start a focus session');
    await pet.webContents.executeJavaScript("document.querySelector('#bubble').style.display = 'none'; 0");
    await wait(600);
    await shot(pet, '6-pet-ring');
    // Feelings: the 3rd nudge of one drift throws a bomb across the screen,
    // the 3rd snooze within an hour gets the big "I'M NOT MAD".
    const fxVisible = () => fx.isVisible();
    await clip('fx', 7, async () => {
      for (let i = 0; i < 3 && !fxVisible(); i++) {
        await client.call('POST', '/debug/emit', { type: 'nudge', message: 'Still drifting. "Banafah verification" is waiting.', nextAction: 'Upload storefront photo' });
        await wait(700);
      }
      if (!fxVisible()) throw new Error('3rd drift nudge did not throw the bomb');
      await wait(1900); // mid-explosion
      await shot(fx, '7-fx-bomb');
      for (let i = 0; i < 40 && fxVisible(); i++) await wait(150);
    }, { win: fx });
    step('fx-bomb', true);
    await clip('fx-rage', 4, async () => {
      for (let i = 0; i < 3 && !fxVisible(); i++) {
        await client.call('POST', '/pause', { paused: true, minutes: 10 });
        await wait(400);
        await client.call('POST', '/pause', { paused: false });
        await wait(400);
      }
      if (!fxVisible()) throw new Error('3rd snooze did not show the rage text');
      await wait(900);
      await shot(fx, '8-fx-rage');
      for (let i = 0; i < 40 && fxVisible(); i++) await wait(150);
    }, { win: fx });
    step('fx-rage', true);
    // The good part: a flow combo aura, then a side-task bubble with "Part of it".
    await pet.webContents.executeJavaScript("document.getElementById('bubble').style.display = 'none'; 0");
    await client.call('POST', '/debug/emit', { type: 'game', events: [{ type: 'flow', level: 3, minutes: 15 }] });
    await wait(600);
    await client.call('POST', '/debug/emit', { type: 'status', status: { flow: { level: 3, minutes: 15 } } });
    await wait(900);
    await shot(pet, '9-pet-flow');
    await client.call('POST', '/debug/emit', { type: 'nudge', kind: 'side-task', message: 'Side task? This looks like "orders", not "Edit the Elementor home page".', nextAction: 'Park it and go back to: Change the hero text' });
    await wait(1200);
    const sideButton = await pet.webContents.executeJavaScript("document.getElementById('b-wrong').style.display !== 'none' ? document.getElementById('b-wrong').textContent : null");
    step('side-task', { button: sideButton });
    if (sideButton !== 'Part of it') throw new Error('side-task bubble has no "Part of it" button');
    await shot(pet, '10-pet-side-task');
    await pet.webContents.executeJavaScript("document.getElementById('b-ok').click(); document.getElementById('bubble').style.display = 'none'; 0");
    panel.show(); panel.webContents.send('bd:refresh');
    await wait(1500);
    await shot(panel, '4-panel');
    // Add a quest through the panel's real form.
    await panel.webContents.executeJavaScript(`(() => {
      document.getElementById('new-quest').open = true;
      document.getElementById('q-title').value = 'Write the White Friday email';
      document.getElementById('q-steps').value = ['Open last year email', 'List 3 offers', 'Draft subject line'].join(String.fromCharCode(10));
      document.getElementById('q-deadline').value = '2026-11-20';
      document.getElementById('q-tag').value = 'Sales';
      document.getElementById('q-allow').value = 'mailchimp, white friday';
      document.getElementById('q-submit').click();
    })()`);
    await wait(1500);
    const afterAdd = await client.call('GET', '/status');
    step('panel-quest', afterAdd.quest);
    if (afterAdd.quest?.title !== 'Write the White Friday email' || afterAdd.quest?.boss?.max !== 3) throw new Error('panel form did not create the quest');
    await panel.webContents.executeJavaScript("document.querySelector('main').scrollTop = 0");
    await shot(panel, '5-panel-after-add');
    // Rewards: parking an idea earns the first achievement; the HUD shows it with the settings below.
    await client.call('POST', '/vault/park', { note: 'dark mode idea' });
    await wait(600);
    panel.webContents.send('bd:refresh');
    await wait(1200);
    await panel.webContents.executeJavaScript("document.getElementById('rewards-card').scrollIntoView(); 0");
    await wait(400);
    await shot(panel, '11-panel-rewards');
    await panel.webContents.executeJavaScript("document.getElementById('settings-card').scrollIntoView(); 0");
    await wait(400);
    await shot(panel, '12-panel-settings');
    const rw = await client.call('GET', '/rewards');
    step('rewards', { achievements: rw.achievements.filter((a) => a.unlocked).map((a) => a.id), mood: rw.mood });
    if (!rw.achievements.find((a) => a.id === 'first-park')?.unlocked) throw new Error('parking did not earn "Parked, not chased"');
    report.ok = true;
  } catch (e) { report.ok = false; report.error = String(e.stack || e); }
  writeFileSync(path.join(SELFTEST_DIR, 'report.json'), JSON.stringify(report, null, 2));
  try { process.kill(JSON.parse(readFileSync(path.join(process.env.BD_DATA_DIR, 'daemon.json'), 'utf8')).pid); } catch { /* not ours */ }
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(() => {
  createPet();
  createPanel();
  createFx();
  // A screen unplugged or resized: settle on the remembered one (or the primary).
  for (const ev of ['display-removed', 'display-added', 'display-metrics-changed']) screen.on(ev, () => placeOn(homeDisplay()));
  if (!SELFTEST_DIR) {
    createTray();
    globalShortcut.register('Control+Alt+D', () => act('done').catch(() => {}));
    globalShortcut.register('Control+Alt+P', () => act('pause-toggle').catch(() => {}));
    globalShortcut.register('Control+Alt+B', togglePanel);
  }
  unsubscribe = client.subscribe((event) => send('bd:event', event), { onState: (s) => { connected = s === 'connected'; send('bd:connection', s); } });
  if (SELFTEST_DIR) pet.webContents.once('did-finish-load', () => setTimeout(selftest, 1500));
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); unsubscribe?.(); });
app.on('window-all-closed', (e) => e.preventDefault());
