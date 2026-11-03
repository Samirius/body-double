import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';

// A companion on a fake clock, with a scripted window and an optional fake judge.
function setup({ window, judge = null, quest = {} }) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-scope-')));
  let clock = Date.parse('2026-11-03T10:00:00');
  const said = [], game = [], statuses = [];
  const c = createCompanion({
    store, judge,
    watcher: { sample: async () => ({ idleSeconds: 0, ...window() }) },
    ui: { nudge: async (n) => said.push(n), gameEvents: (e) => game.push(...e), status: (s) => statuses.push(s) },
    makeBrain: (cb) => createBrain(cb), timing: { morningHour: 24, eveningHour: 24 }, driftOptions: { driftAfterSeconds: 60 }, now: () => clock,
  });
  c.addQuest(makeQuest({ title: 'Edit the Elementor home page', steps: ['Change the hero text', 'Fix the footer'], allow: ['wordpress', 'my shop'], ...quest }));
  const run = async (minutes) => { for (let i = 0; i < minutes * 4; i++) { await c.tick(); clock += 15_000; } };
  return { c, store, said, game, statuses, run };
}

test('scenario: in a Zoom call nothing interrupts, even while "drifting"; it speaks again after the call', async () => {
  let w = { app: 'zoom', title: 'Zoom Meeting' };
  const h = setup({ window: () => w });
  await h.run(10);
  assert.equal(h.said.length, 0);
  assert.equal(h.c.status().quiet, true);
  assert.ok(h.statuses.some((s) => s.quiet === true));
  w = { app: 'brave', title: 'Funny cats - YouTube - Brave' };
  await h.run(1);
  assert.equal(h.said.filter((n) => n.kind === 'drift').length, 0, 'grace period right after the call');
  await h.run(4);
  assert.ok(h.said.some((n) => n.kind === 'drift'));
});

test('scenario: 16 focused minutes build FLOW x3; drifting banks it into the flow stats', async () => {
  let w = { app: 'brave', title: 'Edit Page “Home” ‹ My Shop — Elementor - Brave' };
  const h = setup({ window: () => w });
  await h.run(16);
  assert.deepEqual(h.game.filter((e) => e.type === 'flow').map((e) => e.level), [1, 2, 3]);
  w = { app: 'brave', title: 'Funny cats - YouTube - Brave' };
  await h.run(1);
  const banked = h.game.find((e) => e.type === 'flow-banked');
  assert.equal(banked.level, 3);
  assert.ok(h.store.get().flow.totalMinutes >= 15);
});

test('scenario: a 25-minute session with no drift is a perfect session; one drift spoils it', async () => {
  const h = setup({ window: () => ({ app: 'brave', title: 'Edit Page “Home” ‹ My Shop — Elementor - Brave' }) });
  await h.c.startSession({ minutes: 25 });
  await h.run(26);
  assert.ok(h.game.some((e) => e.type === 'perfect-session' && e.minutes === 25));
  // ...which earns the "Clean Run" achievement and unlocks the shades.
  assert.ok(h.game.some((e) => e.type === 'achievement' && e.id === 'clean-run' && e.cosmetic === 'shades'));
  assert.equal(h.c.rewards().wardrobe.find((w) => w.id === 'shades').unlocked, true);
  assert.ok(h.c.status().rewards.happiness > 60);
  let w = { app: 'brave', title: 'Funny cats - YouTube - Brave' };
  const h2 = setup({ window: () => w });
  await h2.c.startSession({ minutes: 25 });
  await h2.run(3); w = { app: 'brave', title: 'Edit Page “Home” ‹ My Shop — Elementor - Brave' };
  await h2.run(23);
  assert.ok(h2.game.some((e) => e.type === 'session-done'));
  assert.equal(h2.game.some((e) => e.type === 'perfect-session'), false);
});

test('scenario: Elementor page edit -> WooCommerce orders on the same site is caught as a side task; "part of it" teaches it', async () => {
  let w = { app: 'brave', title: 'Edit Page “Home” ‹ My Shop — Elementor - Brave' };
  const judged = [];
  // Fake local decider: anything that isn't the Elementor page is another job.
  const judge = { mode: 'local', judge: async ({ sample }) => { judged.push(sample.title); return { verdict: /elementor/i.test(sample.title) ? 'on-task' : 'off-task', source: 'local' }; } };
  const h = setup({ window: () => w, judge });
  await h.run(11); // the first 10 on-task minutes define the quest's pages
  w = { app: 'brave', title: 'Orders ‹ My Shop — WooCommerce - Brave' };
  await h.run(7);
  const side = h.said.find((n) => n.kind === 'side-task');
  assert.ok(side, 'side task pointed out');
  assert.match(side.message, /orders/);
  assert.equal(h.said.filter((n) => n.kind === 'side-task').length, 1, 'once per page, not every tick');
  assert.deepEqual(h.c.allowScope(), { allowed: 'orders' });
  assert.ok(h.store.activeQuest().scopeAllow.includes('orders'));
});

test('scenario: with no model at all, a new page held 6+ minutes after the start gets one "side task?"; pages from the start never do', async () => {
  let w = { app: 'brave', title: 'Edit Page “Home” ‹ My Shop — Elementor - Brave' };
  const h = setup({ window: () => w });
  await h.run(4);
  w = { app: 'brave', title: 'Media Library ‹ My Shop — WordPress - Brave' }; // part of the job, seen early
  await h.run(4);
  w = { app: 'brave', title: 'Edit Page “Home” ‹ My Shop — Elementor - Brave' };
  await h.run(4);
  w = { app: 'brave', title: 'Media Library ‹ My Shop — WordPress - Brave' };
  await h.run(8);
  assert.equal(h.said.filter((n) => n.kind === 'side-task').length, 0, 'early pages are in scope');
  w = { app: 'brave', title: 'Orders ‹ My Shop — WooCommerce - Brave' };
  await h.run(5);
  assert.equal(h.said.filter((n) => n.kind === 'side-task').length, 0, 'a short look is fine');
  await h.run(3);
  assert.equal(h.said.filter((n) => n.kind === 'side-task').length, 1);
});

test('scenario: asking the agent for "also a dark mode" during a bug fix is scope creep; the fix itself is not', async () => {
  const h = setup({ window: () => ({ app: 'code', title: 'checkout.js - shop - Visual Studio Code' }), quest: { title: 'Fix the checkout bug' } });
  const creep = await h.c.scopeCheck("while you're at it, also add a dark mode toggle");
  assert.equal(creep.verdict, 'creep');
  assert.match(creep.suggestion, /commit/);
  assert.ok(h.said.some((n) => n.kind === 'scope'));
  assert.equal((await h.c.scopeCheck('the submit button still throws, look at line 40')).verdict, 'in-scope');
});

test('scenario: a bug fix that grew to 10 changed files with no commit gets "commit what works"', async () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'bd-scope-git-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(path.join(repo, 'a.js'), 'a\n'); git('add', '.'); git('commit', '-qm', 'init');
  for (let i = 0; i < 10; i++) writeFileSync(path.join(repo, `feature${i}.js`), 'x\n'.repeat(50));
  const h = setup({ window: () => ({ app: 'code', title: 'checkout.js - shop - Visual Studio Code' }), quest: { title: 'Fix the checkout bug', repo, allow: ['checkout'] } });
  h.store.update((st) => st); // clock is a fixed 2026 date, so the last commit looks old
  await h.run(6);
  const warn = h.said.find((n) => n.kind === 'scope');
  assert.ok(warn, 'scope warning');
  assert.match(warn.message, /10 files changed/);
});

test('real-use regression: a quest with no keywords ("finish some work") still builds flow and counts the comeback', async () => {
  let w = { app: 'code', title: 'index.js - shop - Visual Studio Code' };
  const h = setup({ window: () => w, quest: { title: 'finish some work', allow: [], steps: ['Open the file'] } });
  await h.run(11);
  assert.ok(h.game.some((e) => e.type === 'flow'), 'work is recognised without keywords');
  w = { app: 'brave', title: 'Funny cats - YouTube - Brave' };
  await h.run(3);
  assert.ok(h.said.some((n) => n.kind === 'drift'));
  w = { app: 'code', title: 'index.js - shop - Visual Studio Code' };
  await h.run(1);
  assert.ok(h.game.some((e) => e.type === 'returned'), 'the comeback is counted');
});
