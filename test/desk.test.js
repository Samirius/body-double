import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';
import { createCards } from '../src/cards.js';
import { createDesk, ascii } from '../src/desk.js';

// A simulated USB port: an ESP32 that answers HELLO, and one that is something else.
function fakePorts({ desk = true } = {}) {
  const written = [];
  let lineFn = () => {}, closeFn = () => {};
  const ports = {
    list: async () => [{ path: 'COM1' }, { path: 'COM7', vendorId: '10c4' }],
    open: async (p) => {
      assert.equal(p, 'COM7', 'only ESP32 USB chips are tried');
      return {
        write: (l) => { written.push(l); if (l === 'P' && desk) setTimeout(() => lineFn('HELLO nudgling-desk 1'), 5); },
        onLine: (fn) => { lineFn = fn; },
        onClose: (fn) => { closeFn = fn; },
        close: () => {},
      };
    },
  };
  return { ports, written, fromDesk: (l) => lineFn(l), unplug: () => closeFn() };
}

function setup(ports) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-desk-')));
  const ui = { nudge: async () => {}, gameEvents: () => {}, status: () => {} };
  const companion = createCompanion({ store, ui, watcher: { sample: async () => null }, makeBrain: (cb) => createBrain(cb) });
  companion.addQuest(makeQuest({ title: 'Banafah — بنفعة verification', steps: ['Add store hours', 'Upload photo'] }));
  const cards = createCards({ store, companion, ui, launcher: { claudeApp: () => true, clipboard: () => true, url: () => true, folder: () => false } });
  return { store, companion, cards, desk: createDesk({ companion, cards, ports }) };
}

test('desk: finds the ESP32 by its USB chip, shakes hands, and mirrors quest, step and pose', { timeout: 15_000 }, async () => {
  const f = fakePorts();
  const h = setup(f.ports);
  await h.desk.scan();
  assert.deepEqual(h.desk.connected(), { path: 'COM7' });
  assert.ok(f.written.includes('S 0 1'), f.written.join(' | '));
  assert.ok(f.written.includes('Q Banafah ? verification'), 'non-ASCII becomes ? on the TFT');
  assert.ok(f.written.includes('N Add store hours'));
  assert.ok(f.written.includes('T 0 0 -'));
  // Only changes are sent again.
  const n = f.written.length;
  h.desk.sync();
  assert.equal(f.written.length, n);
  await h.companion.startSession({ minutes: 25 });
  h.desk.sync();
  assert.ok(f.written.some((l) => /^T 1500 1500 F$/.test(l)));
});

test('desk: a card tap and the button act; nudges, cheers and lock pulses reach the screen', { timeout: 15_000 }, async () => {
  const f = fakePorts();
  const h = setup(f.ports);
  await h.desk.scan();
  h.cards.assign({ id: 'C0FFEE', action: 'done' });
  f.fromDesk('CARD C0FFEE');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.store.activeQuest().steps[0].done, true, 'card DONE finished a step');
  f.fromDesk('BTN 1');
  assert.equal(h.store.activeQuest().steps[1].done, true, 'the button finished the next one');
  h.desk.nudge({ message: 'Quick check: Banafah?', nextAction: 'Upload photo' });
  assert.ok(f.written.includes('M Quick check: Banafah? > Upload photo'));
  assert.ok(f.written.includes('S 1 1'), 'talks while showing the message');
  h.desk.game({ type: 'xp', amount: 10 });
  h.desk.game({ type: 'lock-pulse', minutes: 6 });
  assert.deepEqual(f.written.slice(-2), ['C', 'L 6']);
  f.unplug();
  assert.equal(h.desk.connected(), null);
});

test('desk: a USB device that never says HELLO is left alone for a minute', { timeout: 15_000 }, async () => {
  const f = fakePorts({ desk: false });
  const h = setup(f.ports);
  await h.desk.scan();
  assert.equal(h.desk.connected(), null);
  const tries = f.written.length;
  await h.desk.scan();
  assert.equal(f.written.length, tries, 'not reopened right away');
  assert.equal(ascii('Café ✓ done'), 'Cafe ? done');
});
