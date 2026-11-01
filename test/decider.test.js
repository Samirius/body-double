import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDecider, isLocalUrl, deciderQuestion } from '../src/agent/decider.js';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';

// A stand-in for llama.cpp's /v1/systemone: records requests, answers from a script.
async function mockSystemOne(answer) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    requests.push({ url: req.url, body: JSON.parse(body) });
    const a = typeof answer === 'function' ? answer(JSON.parse(body)) : answer;
    res.writeHead(a.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(a.body ?? { answers: { fit: a } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise((r) => server.close(r)) };
}
// Tests speak in verdicts; the wire uses the binary labels work / other.
const WIRE = { 'on-task': 'work', 'off-task': 'other' };
const fit = (verdict, p) => { const choice = WIRE[verdict]; return { type: 'choice', choice, probabilities: { work: 1 - p, other: 1 - p, [choice]: p }, confidence: p }; };
const quest = { title: 'Banafah verification', tag: 'Client Work' };
const sample = { app: 'brave', title: 'Ask HN: burnout - Hacker News - Brave' };

test('decider: sends one typed question with the state to /systemone, and nothing else', async () => {
  const m = await mockSystemOne(fit('off-task', 0.92));
  try {
    const d = createDecider({ baseUrl: m.url, modelId: 'julia-1' });
    const r = await d.judge({ quest, nextStep: { text: 'Add store hours' }, sample, minutes: 6 });
    assert.deepEqual([r.verdict, r.source], ['off-task', 'local']);
    assert.equal(m.requests[0].url, '/v1/systemone');
    const b = m.requests[0].body;
    assert.equal(b.model, 'julia-1');
    assert.deepEqual(b.state, { quest: 'Banafah verification', next_step: 'Add store hours', app: 'brave', window_title: sample.title });
    assert.deepEqual(Object.keys(b.questions), ['fit']);
    assert.deepEqual(b.questions.fit.criteria, deciderQuestion('Banafah verification').fit.criteria);
    assert.match(b.questions.fit.criteria.work, /Banafah verification/);
  } finally { await m.close(); }
});

test('decider: below the confidence threshold it stays quiet (unsure)', async () => {
  const m = await mockSystemOne(fit('off-task', 0.6));
  try {
    const r = await createDecider({ baseUrl: m.url, threshold: 0.75 }).judge({ quest, sample });
    assert.equal(r.verdict, 'unsure');
    assert.match(r.reason, /off-task p=0\.60/);
    assert.equal(r.choice, 'off-task');
  } finally { await m.close(); }
});

test('decider: server errors or a missing server give unsure, never a crash', async () => {
  const m = await mockSystemOne({ status: 500, body: { error: 'boom' } });
  const errors = [];
  try {
    assert.equal((await createDecider({ baseUrl: m.url, log: (t) => errors.push(t) }).judge({ quest, sample })).verdict, 'unsure');
  } finally { await m.close(); }
  assert.equal((await createDecider({ baseUrl: 'http://127.0.0.1:9/v1' }).judge({ quest, sample })).verdict, 'unsure');
  assert.ok(errors.includes('decider-error'));
});

test('decider: refuses an endpoint that is not this machine unless allowed on purpose', () => {
  assert.ok(isLocalUrl('http://127.0.0.1:18090/v1') && isLocalUrl('http://localhost:1/v1'));
  assert.throws(() => createDecider({ baseUrl: 'https://api.typesafe.ai/v1' }), /not on this machine/);
  assert.doesNotThrow(() => createDecider({ baseUrl: 'https://api.typesafe.ai/v1', allowRemote: true }));
});

test('decider in the companion: judges an unclear stretch and the chat check, locally', async () => {
  const m = await mockSystemOne((req) => fit(/hacker news|new project/i.test(req.state.window_title) ? 'off-task' : 'on-task', 0.9));
  try {
    const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-dec-')));
    let clock = Date.parse('2026-11-02T10:00:00');
    const said = [];
    const queue = Array(50).fill(sample);
    const c = createCompanion({
      store, judge: createDecider({ baseUrl: m.url }), ui: { nudge: async (n) => said.push(n) }, makeBrain: (cb) => createBrain(cb),
      watcher: { sample: async () => ({ ...queue.shift(), idleSeconds: 0 }) }, timing: { morningHour: 24, eveningHour: 24, unclearMinutes: 6 }, now: () => clock,
    });
    c.addQuest(makeQuest({ title: 'Banafah verification', steps: ['Add store hours'] }));
    for (let i = 0; i < 50; i++) { await c.tick(); clock += 15_000; }
    assert.equal(said.filter((n) => n.kind === 'drift').length, 1, 'off-task verdict -> one drift nudge');
    assert.ok(store.get().log.some((e) => e.type === 'judged' && e.source === 'local'));
    const chat = await c.noteChat('brainstorm a new project for the hackathon');
    assert.equal(chat.verdict, 'off-task');
    assert.equal(chat.nudged, true);
    assert.ok(!JSON.stringify(store.get()).includes('brainstorm'), 'chat text never stored');
  } finally { await m.close(); }
});
