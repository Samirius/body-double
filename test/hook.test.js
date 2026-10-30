import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';

function setup(verdict) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-chat-')));
  let clock = Date.parse('2026-11-02T10:00:00');
  const said = [];
  const judge = { mode: 'title', judge: async () => ({ verdict, reason: 'new project idea', source: 'title' }) };
  const c = createCompanion({ store, watcher: { sample: async () => null }, judge, ui: { nudge: async (n) => said.push(n) }, makeBrain: (cb) => createBrain(cb), timing: { morningHour: 24, eveningHour: 24 }, now: () => clock });
  return { c, store, said, advance: (ms) => { clock += ms; } };
}

test('chat drift: off-topic chat during a quest gets one gentle nudge per 30 min; text never stored', async () => {
  const h = setup('off-task');
  assert.deepEqual(await h.c.noteChat('ideas for a new hackathon project'), { checked: false, why: 'no active quest' });
  h.c.addQuest(makeQuest({ title: 'Banafah verification', steps: ['Add store hours'] }));
  const r = await h.c.noteChat('ideas for a new hackathon project');
  assert.equal(r.nudged, true);
  assert.equal(h.said[0].kind, 'chat');
  assert.match(h.said[0].message, /not about "Banafah verification"/);
  assert.match(h.said[0].nextAction, /Save the idea in one line, then: Add store hours/);
  assert.equal((await h.c.noteChat('more ideas')).nudged, false, 'cooldown');
  h.advance(31 * 60_000);
  assert.equal((await h.c.noteChat('even more ideas')).nudged, true);
  assert.ok(!JSON.stringify(h.store.get()).includes('hackathon'), 'chat text never persisted');
  assert.equal(h.store.get().nudges.sent, 0, 'not counted as a drift nudge');
});

test('chat drift: on-topic chat is left alone; paused means no check', async () => {
  const h = setup('on-task');
  h.c.addQuest(makeQuest({ title: 'Banafah verification', steps: ['Add store hours'] }));
  assert.equal((await h.c.noteChat('how do I add store hours in merchant center')).nudged, undefined);
  h.c.setPaused(true);
  assert.equal((await h.c.noteChat('anything')).checked, false);
  assert.equal(h.said.length, 0);
});

test('hook script: silent, fast, exit 0 even when the companion is not running or input is junk', () => {
  const t = Date.now();
  const r = spawnSync(process.execPath, ['scripts/claude-hook.mjs'], { input: JSON.stringify({ prompt: 'hello' }), env: { ...process.env, BD_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'bd-hook-')) }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(Date.now() - t < 3000);
  const bad = spawnSync(process.execPath, ['scripts/claude-hook.mjs'], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
});
