import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';

function setup(script = []) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-vault-')));
  let clock = Date.parse('2026-11-02T18:30:00');
  const queue = [...script];
  const said = [], game = [];
  const c = createCompanion({ store, watcher: { sample: async () => { const s = queue.shift(); return s ? { idleSeconds: 0, ...s } : null; } }, ui: { nudge: async (n) => said.push(n), gameEvents: (e) => game.push(...e) }, makeBrain: (cb) => createBrain(cb), timing: { morningHour: 24, eveningHour: 19 }, now: () => clock });
  c.addQuest(makeQuest({ title: 'Banafah verification', steps: ['Add store hours'], allow: ['merchant center'] }));
  const run = async () => { while (queue.length) { await c.tick(); clock += 15_000; } };
  return { c, store, said, game, run, push: (...s) => queue.push(...s), setClock: (t) => { clock = t; } };
}

test('vault: "park it" saves the window I drifted to (title kept, browser name dropped)', async () => {
  const h = setup([{ app: 'brave', title: 'Best mechanical keyboards 2026 - YouTube - Brave' }]);
  await h.run();
  const item = h.c.park();
  assert.equal(item.key, 'youtube');
  assert.equal(item.title, 'Best mechanical keyboards 2026 - YouTube');
  assert.equal(item.quest, 'Banafah verification');
  assert.deepEqual(h.c.vault().map((v) => v.id), [item.id]);
  assert.equal(h.game.at(-1).type, 'parked');
});

test('vault: parking a note (e.g. an idea from a chat), undo, and the nothing-to-park case', async () => {
  const h = setup();
  assert.throws(() => h.c.park(), /nothing to park/);
  const a = h.c.park({ note: 'Idea: a cyberpunk HUD for the pet' });
  assert.equal(a.note, 'Idea: a cyberpunk HUD for the pet');
  assert.equal(a.title, null);
  assert.deepEqual(h.c.unpark(a.id), { removed: 1 });
  assert.equal(h.c.vault().length, 0);
});

test('vault: the evening summary counts what was parked today', async () => {
  const h = setup([{ app: 'brave', title: 'Merchant Center - Brave' }]);
  await h.run();
  h.c.completeNextStep();
  h.c.park({ note: 'look at GPU prices later' });
  h.setClock(Date.parse('2026-11-02T19:10:00'));
  h.push({ app: 'brave', title: 'Merchant Center - Brave' });
  await h.run();
  const evening = h.said.find((n) => n.kind === 'evening');
  assert.match(evening.message, /1 thing parked for later \(in your vault\)/);
});
