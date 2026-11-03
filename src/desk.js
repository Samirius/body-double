// The Nudgling Desk bridge: finds the ESP32 on USB, mirrors the creature's
// state to its screen, and turns its card taps and button into actions.
// Line protocol: see hardware/nudgling-desk/nudgling-desk.ino.
import { petStage } from './core/game.js';

// USB-serial chips found on ESP32 boards: CP210x, CH340/CH9102, Espressif native USB, FTDI.
const VIDS = ['10C4', '1A86', '303A', '0403'];
const POSE = { idle: 0, talk: 1, cheer: 2, sleep: 3, worry: 4 };
const CHEER = new Set(['xp', 'level-up', 'title', 'boss-defeated', 'pet-evolved', 'returned', 'achievement', 'perfect-session', 'session-done']);
// The TFT font is ASCII: accents are dropped, other scripts become '?'.
export const ascii = (s, n = 80) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]+/g, '?').replace(/\?(\s*\?)+/g, '?').replace(/\s+/g, ' ').trim().slice(0, n);

// Default USB access through the serialport package (loaded only when used).
async function defaultPorts() {
  const { SerialPort } = await import('serialport');
  const { ReadlineParser } = await import('@serialport/parser-readline');
  return {
    list: () => SerialPort.list(),
    open: (path) => new Promise((resolve, reject) => {
      const port = new SerialPort({ path, baudRate: 115200 }, (err) => (err ? reject(err) : resolve({
        write: (line) => port.write(`${line}\n`),
        onLine: (fn) => port.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', (l) => fn(String(l).trim())),
        onClose: (fn) => { port.on('close', fn); port.on('error', fn); },
        close: () => { try { port.close(); } catch { /* already closed */ } },
      })));
    }),
  };
}

export function createDesk({ companion, cards, ports = null, log = () => {}, now = Date.now }) {
  let io = ports, link = null, path = null, sent = new Map(), talkUntil = 0, scanning = false;
  const tried = new Map(); // path -> time a non-Nudgling device was seen there

  const send = (line, { force = false } = {}) => {
    if (!link) return;
    const key = line[0];
    if (!force && sent.get(key) === line) return;
    sent.set(key, line);
    link.write(line);
  };

  function onLine(line) {
    if (line.startsWith('CARD ')) cards.tap(line.slice(5)).catch((e) => log('desk-card-error', { error: String(e.message || e).slice(0, 120) }));
    else if (line === 'BTN 1') companion.completeNextStep();
  }

  // Opens a port and waits for the desk's HELLO (the ESP32 restarts when the port opens).
  async function tryPort(p) {
    let l;
    try { l = await io.open(p); } catch { tried.set(p, now()); return false; }
    const hello = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      l.onLine((line) => { if (line.startsWith('HELLO nudgling-desk')) { clearTimeout(timer); resolve(true); } else if (link === l) onLine(line); });
      setTimeout(() => l.write('P'), 1500);
    });
    if (!hello) { l.close(); tried.set(p, now()); return false; }
    link = l; path = p; sent = new Map();
    l.onClose(() => { if (link === l) { link = null; log('desk-disconnected', {}); } });
    log('desk-connected', { path: p });
    sync({ force: true });
    return true;
  }

  async function scan() {
    if (link || scanning) return;
    scanning = true;
    try {
      io ||= await defaultPorts();
      const list = await io.list();
      for (const p of list) {
        if (!VIDS.includes(String(p.vendorId || '').toUpperCase())) continue;
        if (now() - (tried.get(p.path) || 0) < 60_000) continue; // not a desk: look again in a minute
        if (await tryPort(p.path)) break;
      }
    } catch (e) { log('desk-scan-error', { error: String(e.message || e).slice(0, 120) }); } finally { scanning = false; }
  }

  // The creature's state, sent only when it changes (force: everything again).
  function sync({ force = false } = {}) {
    if (!link) return;
    const s = companion.status();
    const pose = s.paused || s.label === 'away' ? 'sleep' : now() < talkUntil ? 'talk' : s.label === 'drift' ? 'worry' : 'idle';
    send(`S ${POSE[pose]} ${petStage(s.level.level)}`, { force });
    const sess = s.session;
    const left = sess ? Math.max(0, Math.round((sess.endAt - now()) / 1000)) : 0;
    // The desk counts down by itself between syncs; each sync corrects any drift.
    send(sess ? `T ${left} ${sess.minutes * 60} ${sess.kind === 'break' ? 'B' : 'F'}` : 'T 0 0 -', { force });
    send(`Q ${ascii(s.quest?.title || 'Nudgling', 60)}`, { force });
    send(`N ${ascii(s.quest?.next || 'Tap a card to start', 80)}`, { force });
    send(`F ${s.flow?.level || 0}`, { force });
  }

  return {
    scan,
    sync,
    connected: () => (link ? { path } : null),
    // Live events from the companion (the daemon's ui hooks call these).
    nudge(n) { if (!link) return; talkUntil = now() + 8000; send(`M ${ascii(`${n.message} ${n.nextAction ? `> ${n.nextAction}` : ''}`, 110)}`, { force: true }); sync(); },
    game(e) { if (!link) return; if (e.type === 'lock-pulse') send(`L ${e.minutes}`, { force: true }); else if (CHEER.has(e.type)) send('C', { force: true }); },
    close() { link?.close(); link = null; },
  };
}
