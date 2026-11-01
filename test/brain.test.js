import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, fauxText } from '@earendil-works/pi-ai';
import http from 'node:http';
import { createBrain, buildPrompt, createLlamaHandle } from '../src/agent/brain.js';

const quest = { title: 'Banafah verification', tag: 'Client Work', deadline: '2026-11-06' };
const nextStep = { id: 's1', text: 'Write the store hours in Merchant Center' };
const event = { type: 'drift', driftedSeconds: 240, nudgeNumber: 1, reason: 'matches distraction "youtube"' };
const stats = { sent: 3, returned: 2, returnSeconds: [40, 90] };

function fauxHandle(responses) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  return { models, model: faux.getModel(), faux };
}

test('brain: without a model it uses a template naming the quest and the next step', async () => {
  const shown = [];
  const brain = createBrain({ onNudge: async (n, src) => shown.push({ ...n, src }), onSplit: async () => {} });
  await brain.handle({ quest, nextStep, event, stats });
  assert.equal(shown[0].src, 'template');
  assert.match(shown[0].message, /Banafah/);
  assert.equal(shown[0].nextAction, nextStep.text);
});

test('brain: model splits a big step, then nudges toward the first tiny one', async () => {
  const h = fauxHandle([
    fauxAssistantMessage([fauxToolCall('split_step', { steps: ['Open Merchant Center', 'Click Business info', 'Paste the hours'] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('nudge', { message: 'Banafah first.', nextAction: 'Open Merchant Center' })], { stopReason: 'toolUse' }),
  ]);
  const shown = [], splits = [];
  const brain = createBrain({ modelHandle: h, onNudge: async (n, src) => shown.push({ ...n, src }), onSplit: async (s) => splits.push(s) });
  await brain.handle({ quest, nextStep, event, stats });
  assert.deepEqual(splits[0], ['Open Merchant Center', 'Click Business info', 'Paste the hours']);
  assert.deepEqual(shown, [{ message: 'Banafah first.', nextAction: 'Open Merchant Center', src: `model:${h.model.id}` }]);
});

test('brain: a model that answers in plain text still produces a template nudge', async () => {
  const h = fauxHandle([fauxAssistantMessage([fauxText('You should get back to work!')])]);
  const shown = [];
  const brain = createBrain({ modelHandle: h, onNudge: async (n, src) => shown.push(src), onSplit: async () => {} });
  await brain.handle({ quest, nextStep, event, stats });
  assert.deepEqual(shown, ['template-fallback']);
});

test('brain: prompt carries quest, step, drift length and history, never a window title', () => {
  const p = buildPrompt({ quest, nextStep, event, stats, now: new Date('2026-11-01T15:04:00') });
  assert.match(p, /drift for 4 min/);
  assert.match(p, /Banafah verification/);
  assert.match(p, /Write the store hours/);
  assert.match(p, /median 90 s/);
});

test('brain: with no active quest the template asks for one thing instead of "your quest"', async () => {
  const shown = [];
  const brain = createBrain({ onNudge: async (n) => shown.push(n), onSplit: async () => {} });
  await brain.handle({ quest: null, nextStep: null, event: { type: 'drift', driftedSeconds: 200, nudgeNumber: 1 }, stats });
  assert.match(shown[0].message, /No quest yet/);
  assert.match(shown[0].nextAction, /Pick one thing/);
  assert.doesNotMatch(shown[0].message, /your quest/);
});

test('brain: when the first model gives no nudge (no credits, offline), the next one writes it', async () => {
  const broke = fauxHandle([fauxAssistantMessage([fauxText('...')])]);
  const backup = fauxHandle([fauxAssistantMessage([fauxToolCall('nudge', { message: 'Back to Banafah.', nextAction: 'Open Merchant Center' })], { stopReason: 'toolUse' })]);
  const shown = [];
  const brain = createBrain({ modelHandles: [broke, backup], onNudge: async (n, src) => shown.push({ ...n, src }), onSplit: async () => {} });
  await brain.handle({ quest, nextStep, event, stats });
  assert.deepEqual(shown, [{ message: 'Back to Banafah.', nextAction: 'Open Merchant Center', src: `model:${backup.model.id}` }]);
});

test('brain: Llama on this PC is driven over the OpenAI-compatible API with the nudge tool', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      seen.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ id: 'c1', object: 'chat.completion.chunk', model: 'llama-3.2-3b', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'nudge', arguments: JSON.stringify({ message: 'Banafah is waiting.', nextAction: 'Open Merchant Center' }) } }] }, finish_reason: null }] });
      chunk({ id: 'c1', object: 'chat.completion.chunk', model: 'llama-3.2-3b', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const h = await createLlamaHandle(`http://127.0.0.1:${srv.address().port}/v1`);
    const shown = [];
    const brain = createBrain({ modelHandles: [h], onNudge: async (n, src) => shown.push({ ...n, src }), onSplit: async () => {} });
    await brain.handle({ quest, nextStep, event, stats });
    assert.deepEqual(shown, [{ message: 'Banafah is waiting.', nextAction: 'Open Merchant Center', src: 'model:llama-3.2-3b' }]);
    assert.equal(seen[0].url, '/v1/chat/completions');
    assert.equal(seen[0].body.model, 'llama-3.2-3b');
    assert.deepEqual(seen[0].body.tools.map((t) => t.function.name).sort(), ['nudge', 'split_step']);
    // Llama must answer with a tool call, never plain text.
    assert.equal(seen[0].body.tool_choice, 'required');
  } finally { srv.close(); }
});
