import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, fauxText } from '@earendil-works/pi-ai';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain, createJudge, templateNudge } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';
import { killTestReport } from '../src/report.js';

function fauxHandle(responses, input = ['text']) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  return { models, model: { ...faux.getModel(), input }, faux };
}

// A companion on a fake clock. `script` is a list of samples; ticks are 15 s.
function harness({ script, start = '2026-11-02T10:00:00', judge = null, timing = {}, quest = {} }) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-smart-')));
  let clock = Date.parse(start);
  const queue = [...script];
  const watcher = { sample: async () => { const s = queue.shift(); return s ? { idleSeconds: 0, ...s, at: clock } : null; } };
  const said = [];
  const c = createCompanion({ store, watcher, judge, ui: { nudge: async (n) => said.push(n) }, makeBrain: (cb) => createBrain(cb), timing: { morningHour: 24, eveningHour: 24, ...timing }, now: () => clock });
  c.addQuest(makeQuest({ title: 'Banafah verification', tag: 'Client Work', steps: ['Add store hours', 'Upload photo'], allow: ['merchant center'], deadline: '2026-11-06', ...quest }));
  const run = async (n = queue.length) => { for (let i = 0; i < n; i++) { await c.tick(); clock += 15_000; } };
  return { c, store, said, run, push: (...s) => queue.push(...s), setClock: (t) => { clock = t; } };
}

test('judge: verdict comes from the tool call; plain text or no model gives unsure', async () => {
  const sample = { app: 'brave', title: 'Hacker News - Brave' };
  const offTask = createJudge({ modelHandle: fauxHandle([fauxAssistantMessage([fauxToolCall('verdict', { verdict: 'off-task', reason: 'news site' })], { stopReason: 'toolUse' })]) });
  assert.deepEqual(await offTask.judge({ quest: { title: 'x', tag: 'y' }, sample, minutes: 6 }), { verdict: 'off-task', reason: 'news site', source: 'title' });
  const chatty = createJudge({ modelHandle: fauxHandle([fauxAssistantMessage([fauxText('Probably fine')])]) });
  assert.equal((await chatty.judge({ sample, minutes: 6 })).verdict, 'unsure');
  assert.equal(createJudge({}).mode, 'off');
  assert.equal(createJudge({ modelHandle: fauxHandle([]), mode: 'screenshot' }).mode, 'title', 'text-only model never gets screenshots');
  assert.equal(createJudge({ modelHandle: fauxHandle([], ['text', 'image']), mode: 'screenshot' }).mode, 'screenshot');
});

test('smarter: a long unclear stretch is judged once, cached, and an off-task verdict leads to a nudge', async () => {
  let asked = 0;
  const judge = { mode: 'title', judge: async () => { asked++; return { verdict: 'off-task', reason: 'news', source: 'title' }; } };
  const hn = { app: 'brave', title: 'Ask HN: something - Hacker News - Brave' };
  const h = harness({ script: Array(60).fill(hn), judge, timing: { unclearMinutes: 6 } });
  await h.run(24); // 6 minutes of unclear
  assert.equal(asked, 0, 'not before 6 minutes');
  await h.run(2);
  assert.equal(asked, 1);
  assert.equal(h.said.length, 0, 'judged drift still waits the normal 3 min');
  await h.run(); // remaining ~8.5 min
  assert.equal(asked, 1, 'verdict cached for 30 min');
  const drifts = h.said.filter((n) => n.kind === 'drift');
  assert.equal(drifts.length, 2, 'first nudge 3 min after the verdict, a second after the 5 min cooldown');
  assert.match(drifts[1].message, /Still drifting/);
  assert.ok(h.store.get().log.some((e) => e.type === 'judged' && e.key === 'hacker news' && e.verdict === 'off-task'));
  // wrong-nudge on a judged drift allows the site and clears the cached verdict
  const r = h.c.learnFromFeedback('wrong-nudge');
  assert.deepEqual([r.learned, r.keyword], ['allow', 'hacker news']);
});

test('smarter: an on-task verdict makes the site count as on task (no nudge)', async () => {
  const judge = { mode: 'title', judge: async () => ({ verdict: 'on-task', reason: 'quest research', source: 'title' }) };
  const doc = { app: 'brave', title: 'Store hours policy - Google Business Help - Brave' };
  const h = harness({ script: Array(40).fill(doc), judge, timing: { unclearMinutes: 2 } });
  await h.run();
  assert.equal(h.said.length, 0);
  assert.equal(h.c.status().label, 'on-task');
});

test('smarter: stuck after long on-task time without finishing, then the clock restarts', async () => {
  const mc = { app: 'brave', title: 'Merchant Center - Brave' };
  const h = harness({ script: Array(130).fill(mc), timing: { stuckMinutes: 25 } });
  await h.run(100); // 25 minutes on task
  await h.run(2);
  const stuck = h.said.filter((n) => n.kind === 'stuck');
  assert.equal(stuck.length, 1);
  assert.match(stuck[0].nextAction, /Add store hours/);
  assert.equal(h.store.get().nudges.sent, 0, 'stuck offers are not counted as drift nudges');
  h.c.completeNextStep();
  await h.run(); // 7 more minutes: no new stuck
  assert.equal(h.said.filter((n) => n.kind === 'stuck').length, 1);
});

test('smarter: morning plan once per day, evening summary only after real activity', async () => {
  const mc = { app: 'brave', title: 'Merchant Center - Brave' };
  const h = harness({ script: Array(8).fill(mc), start: '2026-11-02T08:30:00', timing: { morningHour: 6, eveningHour: 19 } });
  await h.run(4);
  const morning = h.said.filter((n) => n.kind === 'morning');
  assert.equal(morning.length, 1);
  assert.match(morning[0].message, /Banafah verification \(\d+ days left\)/);
  await h.run(); // still the same morning: no second message
  assert.equal(h.said.filter((n) => n.kind === 'morning').length, 1);
  h.c.completeNextStep();
  h.setClock(Date.parse('2026-11-02T19:05:00'));
  h.push(mc);
  await h.run();
  const evening = h.said.filter((n) => n.kind === 'evening');
  assert.equal(evening.length, 1);
  assert.match(evening[0].message, /Today: 1 step done · \+10 XP.*new title: First Step.*Streak 1 day/);
  assert.equal(h.c.dayActivity('2026-11-02').steps, 1);
});

test('smarter: feedback tunes how soon it nudges, within bounds, and it persists', async () => {
  const h = harness({ script: [] });
  assert.equal(h.c.status().nudgeAfterSeconds, 180);
  h.c.learnFromFeedback('wrong-nudge', { keyword: 'figma' });
  assert.equal(h.c.status().nudgeAfterSeconds, 210);
  for (let i = 0; i < 20; i++) h.c.learnFromFeedback('missed-drift', { keyword: `site${i}` });
  assert.equal(h.c.status().nudgeAfterSeconds, 90, 'floor at 90 s');
  assert.equal(h.store.get().settings.driftAfterSeconds, 90);
});

test('report and templates: only drift nudges count; stuck/evening templates read well', () => {
  const log = [{ at: 1, type: 'nudge', kind: 'stuck' }, { at: 2, type: 'nudge', kind: 'drift' }, { at: 3, type: 'nudge' }];
  assert.match(killTestReport(log), /nudges sent: 2/);
  const q = { title: 'Banafah verification' }, s = { text: 'Upload photo' };
  assert.match(templateNudge({ quest: q, nextStep: s, event: { type: 'stuck', onTaskSeconds: 1500 } }).message, /25 min/);
  assert.equal(templateNudge({ quest: q, nextStep: s, event: { type: 'evening', summary: 'Today: 2 steps.' } }).nextAction, 'Tomorrow, start with: Upload photo');
});

test('smarter: messaging gets a 10 min allowance, then counts as drift; never judged', async () => {
  let asked = 0;
  const judge = { mode: 'title', judge: async () => { asked++; return { verdict: 'on-task', reason: 'x', source: 'title' }; } };
  const wa = { app: 'whatsapp', title: 'WhatsApp' };
  const h = harness({ script: Array(70).fill(wa), judge, timing: { unclearMinutes: 2 } });
  await h.run(40); // 10 minutes
  assert.equal(h.c.status().label, 'unclear', 'still within the allowance');
  await h.run(); // 7.5 more minutes: drift after 10, nudge 3 min later
  assert.equal(asked, 0, 'messaging is never sent to the judge');
  const drifts = h.said.filter((n) => n.kind === 'drift');
  assert.equal(drifts.length, 1);
  assert.ok(h.store.get().log.some((e) => e.type === 'drift' && /messaging \(whatsapp\)/.test(e.reason)));
  // the quest can allow it ("reply to client on WhatsApp")
  const ok = harness({ script: Array(70).fill(wa), quest: { allow: ['whatsapp'] } });
  await ok.run();
  assert.equal(ok.said.length, 0);
});
