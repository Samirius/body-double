import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall, fauxText } from '@earendil-works/pi-ai';
import { createBrain, buildPrompt } from '../src/agent/brain.js';

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
  assert.deepEqual(shown, [{ message: 'Banafah first.', nextAction: 'Open Merchant Center', src: 'model' }]);
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
