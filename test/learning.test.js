import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classify, siteKey } from '../src/core/classifier.js';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';

test('siteKey: site name for browsers, app name otherwise, nothing when unsure', () => {
  assert.equal(siteKey({ app: 'brave', title: 'Show HN: a thing - Hacker News - Brave' }), 'hacker news');
  assert.equal(siteKey({ app: 'chrome', title: 'Cairo traffic | Masrawy - Google Chrome' }), 'masrawy');
  assert.equal(siteKey({ app: 'msedge', title: 'Inbox (3) — Outlook — Microsoft Edge' }), 'outlook');
  assert.equal(siteKey({ app: 'brave', title: 'New Tab - Brave' }), null);
  assert.equal(siteKey({ app: 'whatsapp', title: 'WhatsApp' }), 'whatsapp');
});

test('classifier: reports which rule fired; quest deny beats global list order', () => {
  const c = classify({ app: 'brave', title: 'Funny - YouTube - Brave', idleSeconds: 0 }, { allow: [], deny: [] });
  assert.deepEqual(c.match, { list: 'distractions', keyword: 'youtube' });
  const d = classify({ app: 'brave', title: 'Story - Hacker News - Brave', idleSeconds: 0 }, { allow: [], deny: ['hacker news'] });
  assert.deepEqual(d.match, { list: 'deny', keyword: 'hacker news' });
});

function harness(script, questOpts = {}) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-learn-')));
  let clock = Date.parse('2026-11-01T09:00:00');
  const queue = [...script];
  const watcher = { sample: async () => { const s = queue.shift(); return s ? { ...s, idleSeconds: 0, at: clock } : null; } };
  const nudges = [];
  const c = createCompanion({ store, watcher, ui: { nudge: async (n) => nudges.push(n) }, makeBrain: (cb) => createBrain(cb), driftOptions: { driftAfterSeconds: 60, cooldownSeconds: 120 }, timing: { morningHour: 24, eveningHour: 24 }, now: () => clock });
  c.addQuest(makeQuest({ title: 'Edit course video', tag: 'Creative', steps: ['Cut intro'], allow: ['premiere'], ...questOpts }));
  const run = async (n = queue.length) => { for (let i = 0; i < n; i++) { await c.tick(); clock += 15_000; } };
  return { c, store, nudges, run, push: (...s) => queue.push(...s) };
}

test('learning: "wrong nudge" allows the trigger for this quest, and it stops nudging', async () => {
  const yt = { app: 'brave', title: 'B-roll reference - YouTube - Brave' };
  const h = harness(Array(6).fill(yt));
  await h.run();
  assert.equal(h.nudges.length, 1);
  const r = h.c.learnFromFeedback('wrong-nudge');
  assert.deepEqual([r.learned, r.keyword], ['allow', 'youtube']);
  assert.ok(h.c.rules().quest.allow.includes('youtube'));
  h.push(...Array(12).fill(yt));
  await h.run();
  assert.equal(h.nudges.length, 1, 'no further nudges on the now-allowed site');
  assert.deepEqual(h.c.forgetRule('youtube'), { forgotten: 'youtube', quest: 'Edit course video' });
  assert.ok(!h.c.rules().quest.allow.includes('youtube'));
});

test('learning: "you missed it" finds the site from recent unclear samples and blocks it', async () => {
  const hn = { app: 'brave', title: 'Ask HN: burnout - Hacker News - Brave' };
  const h = harness([...Array(8).fill(hn), { app: 'explorer', title: 'Downloads' }]);
  await h.run();
  assert.equal(h.nudges.length, 0, 'unknown site: no nudge yet');
  const r = h.c.learnFromFeedback('missed-drift');
  assert.deepEqual([r.learned, r.keyword], ['deny', 'hacker news']);
  h.push(...Array(8).fill(hn));
  await h.run();
  assert.equal(h.nudges.length, 1, 'now it nudges on that site');
  // the learned rule never stores the page title itself
  assert.ok(!JSON.stringify(h.store.get()).includes('burnout'));
});

test('learning: explicit keyword wins; nothing learned without a quest or a clue', async () => {
  const h = harness([{ app: 'brave', title: 'New Tab - Brave' }]);
  await h.run();
  assert.equal(h.c.learnFromFeedback('missed-drift').learned, null); // no reliable key
  assert.equal(h.c.learnFromFeedback('missed-drift', { keyword: 'Telegram' }).keyword, 'telegram');
  assert.equal(h.c.learnFromFeedback('wrong-nudge').learned, null); // no recent nudge
  assert.throws(() => h.c.learnFromFeedback('bogus'));
});

test('classifier: X/Twitter only by its title suffix, not any " / x" text', () => {
  const q = { allow: [], deny: [] };
  assert.equal(classify({ app: 'brave', title: 'Home / X - Brave', idleSeconds: 0 }, q).label, 'drift');
  // Not X: counted as work (benefit of the doubt with a quest), never a drift.
  assert.equal(classify({ app: 'brave', title: 'Projects / Xero - Brave', idleSeconds: 0 }, q).label, 'on-task');
  assert.equal(classify({ app: 'claude', title: 'Notes / x-axis plan', idleSeconds: 0 }, q).label, 'on-task');
});
