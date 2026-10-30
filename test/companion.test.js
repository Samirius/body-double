import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';
import { killTestReport } from '../src/report.js';

// Replays a scripted morning through the real companion loop with a fake
// clock and a fake watcher: drift -> nudge -> return -> step done -> XP.
test('companion: a scripted morning, end to end', async () => {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-comp-')));
  let clock = Date.parse('2026-11-01T09:00:00');
  const script = [];
  const push = (n, app, title) => { for (let i = 0; i < n; i++) script.push({ app, title, idleSeconds: 0 }); };
  push(4, 'brave', 'Merchant Center - Business info');   // on task 0..45s
  push(14, 'brave', 'Top 10 goals - YouTube');           // drift 60..255s -> nudge at 240s
  push(3, 'brave', 'Merchant Center - Business info');   // back
  const watcher = { sample: async () => ({ ...script.shift(), at: clock }) };
  const nudges = [], game = [];
  const ui = { nudge: async (n) => nudges.push(n), gameEvents: (e) => game.push(...e) };
  const c = createCompanion({ store, watcher, ui, makeBrain: (cb) => createBrain({ ...cb }), driftOptions: { driftAfterSeconds: 180 }, now: () => clock });
  c.addQuest(makeQuest({ title: 'Banafah verification', tag: 'Client Work', steps: ['Add store hours', 'Request review'], allow: ['merchant center'], deadline: '2026-11-06' }));

  while (script.length) { await c.tick(); clock += 15_000; }
  assert.equal(nudges.length, 1);
  assert.match(nudges[0].message, /Banafah verification/);
  assert.equal(nudges[0].nextAction, 'Add store hours');
  assert.ok(game.some((e) => e.type === 'returned'));

  const events = c.completeNextStep(); // within 5 min of the nudge -> comeback bonus
  assert.equal(events[0].amount, 15);
  assert.equal(c.status().quest.boss.hp, 1);
  assert.equal(store.get().nudges.returned, 1);
  // the log never stores window titles
  assert.ok(!JSON.stringify(store.get().log).includes('Top 10 goals'));
});

test('report: kill-test verdict uses the pre-set thresholds', () => {
  const t = 0;
  const log = [
    ...Array.from({ length: 5 }, (_, i) => ({ at: t + i, type: 'nudge', source: 'template', message: 'm', nextAction: 'a' })),
    { at: 9, type: 'feedback', verdict: 'wrong-nudge' },
    { at: 10, type: 'feedback', verdict: 'missed-drift' },
  ];
  assert.match(killTestReport(log), /caught: 4.*catch rate: 80%/s);
  assert.match(killTestReport(log), /verdict: PASS/);
  assert.match(killTestReport(log.slice(0, 3)), /NOT ENOUGH DATA/);
});
