import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';

function setup(sample) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-sess-')));
  let clock = Date.parse('2026-11-02T10:00:00');
  const said = [], game = [];
  const c = createCompanion({ store, watcher: { sample: async () => ({ idleSeconds: 0, ...sample() }) }, ui: { nudge: async (n) => said.push(n), gameEvents: (e) => game.push(...e) }, makeBrain: (cb) => createBrain(cb), timing: { morningHour: 24, eveningHour: 24 }, driftOptions: { driftAfterSeconds: 60 }, now: () => clock });
  c.addQuest(makeQuest({ title: 'Banafah verification', steps: ['Add store hours'], allow: ['merchant center'] }));
  const run = async (minutes) => { for (let i = 0; i < minutes * 4; i++) { await c.tick(); clock += 15_000; } };
  return { c, store, said, game, run };
}

test('session: starts with a micro-step, ends in a break, then calls back', async () => {
  let current = { app: 'brave', title: 'Merchant Center - Brave' };
  const h = setup(() => current);
  const s = await h.c.startSession({ minutes: 25 });
  assert.equal(s.kind, 'focus');
  assert.equal(h.said[0].kind, 'session-start');
  assert.match(h.said[0].nextAction, /First, just: Add store hours/);
  await h.run(26);
  assert.ok(h.game.some((e) => e.type === 'session-done' && e.minutes === 25));
  assert.equal(h.c.status().session.kind, 'break');
  assert.match(h.said.find((n) => n.kind === 'session-end').nextAction, /drink water \(5 min break\)/);
  // wandering during the break is fine: no drift nudge
  current = { app: 'brave', title: 'Funny cats - YouTube - Brave' };
  await h.run(4);
  assert.equal(h.said.filter((n) => n.kind === 'drift').length, 0);
  await h.run(2);
  assert.equal(h.c.status().session, null);
  assert.ok(h.said.some((n) => n.kind === 'break-end'));
});

test('session: minutes are clamped, stop works, state survives in the store', async () => {
  const h = setup(() => ({ app: 'code', title: 'x' }));
  assert.equal((await h.c.startSession({ minutes: 999 })).minutes, 120);
  assert.equal(h.store.get().session.kind, 'focus');
  assert.deepEqual(h.c.stopSession(), { stopped: true });
  assert.equal(h.c.status().session, null);
});
