// Desktop pet: Electron main process.
//  - pet strip: transparent, always-on-top window along the bottom of the work
//    area; click-through except where the renderer reports the pet or bubble
//  - panel: quest, XP, skills, boss HP, streak, titles, actions
//  - tray icon + global hotkeys (Ctrl+Alt+D done, Ctrl+Alt+P pause, Ctrl+Alt+B panel)
//  - talks to the background service through src/client.js (starts it if needed)
//   npm run pet                     run
//   npm run pet -- --selftest <dir> render, screenshot both windows, quit
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell } from 'electron';
import path from 'node:path';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '../client.js';
import { buildFrame, frameToBitmap } from './sprites.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const selftestIdx = process.argv.indexOf('--selftest');
const SELFTEST_DIR = selftestIdx > 0 ? path.resolve(process.argv[selftestIdx + 1] || 'selftest-out') : null;
const STRIP_HEIGHT = 330; // room for the transmission bubble above the pet

if (!SELFTEST_DIR && !app.requestSingleInstanceLock()) app.quit();

const client = createClient({ env: process.env, nodePath: process.execPath });
let pet = null, panel = null, tray = null, unsubscribe = null, connected = false;
const send = (channel, payload) => { for (const w of [pet, panel]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload); };

function createPet() {
  const area = screen.getPrimaryDisplay().workArea;
  pet = new BrowserWindow({
    x: area.x, y: area.y + area.height - STRIP_HEIGHT, width: area.width, height: STRIP_HEIGHT,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false, skipTaskbar: true,
    focusable: false, alwaysOnTop: true, backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  pet.setAlwaysOnTop(true, 'floating');
  pet.setIgnoreMouseEvents(true, { forward: true });
  pet.loadFile(path.join(here, 'pet.html'));
  pet.once('ready-to-show', () => pet.showInactive());
}

function createPanel() {
  const area = screen.getPrimaryDisplay().workArea;
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
  tray.setToolTip('Focus companion');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show panel', click: togglePanel },
    { label: 'Mark next step done', click: () => act('done') },
    { label: 'Pause / resume', click: () => act('pause-toggle') },
    { label: 'Snooze 10 minutes', click: () => act('snooze', { minutes: 10 }) },
    { label: 'Open stats page', click: () => act('stats').catch(() => {}) },
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
    case 'vault': return client.call('GET', '/vault');
    case 'unpark': return client.call('POST', '/vault/remove', { id: String(payload.id || '') });
    case 'missed': return client.call('POST', '/feedback', { verdict: 'missed-drift' });
    case 'snooze': return client.call('POST', '/pause', { paused: true, minutes: payload.minutes || 10 });
    case 'pause-toggle': { const s = await client.call('GET', '/status'); return client.call('POST', '/pause', { paused: !s.paused }); }
    case 'activate': return client.call('POST', '/quests/activate', { query: String(payload.query || '') });
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
    case 'panel': return togglePanel();
    case 'stats': { const r = await client.call('GET', '/stats'); await shell.openPath(r.htmlPath); return r.totals; }
    default: throw new Error(`unknown action ${name}`);
  }
}

ipcMain.handle('bd:act', async (_e, name, payload) => {
  try { return { ok: true, data: await act(name, payload) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.on('bd:interactive', (_e, on) => { if (pet && !pet.isDestroyed()) pet.setIgnoreMouseEvents(!on, { forward: true }); });

async function selftest() {
  const shot = async (win, name) => { const img = await win.webContents.capturePage(); writeFileSync(path.join(SELFTEST_DIR, `${name}.png`), img.toPNG()); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  mkdirSync(SELFTEST_DIR, { recursive: true });
  const report = { steps: [] };
  const step = (k, v) => report.steps.push({ [k]: v });
  try {
    // Act only once the live event stream is up, as a person would.
    for (let i = 0; i < 80 && !connected; i++) await wait(250);
    if (!connected) throw new Error('event stream never connected');
    step('connected', true);
    await client.call('POST', '/quests', { title: 'Banafah verification', steps: ['Add store hours in Merchant Center', 'Upload storefront photo', 'Request review'], tag: 'Client Work', deadline: '2026-11-06', allow: ['merchant center'] });
    step('quest', 'added');
    const done = await client.call('POST', '/steps/done');
    step('done', done.events.map((e) => e.type));
    await wait(1500);
    await shot(pet, '1-pet-cheer');
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
    report.ok = true;
  } catch (e) { report.ok = false; report.error = String(e.stack || e); }
  writeFileSync(path.join(SELFTEST_DIR, 'report.json'), JSON.stringify(report, null, 2));
  try { process.kill(JSON.parse(readFileSync(path.join(process.env.BD_DATA_DIR, 'daemon.json'), 'utf8')).pid); } catch { /* not ours */ }
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(() => {
  createPet();
  createPanel();
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
