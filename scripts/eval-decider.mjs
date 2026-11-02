#!/usr/bin/env node
// Measures a local decision model on eval/decider/cases.json before you trust
// it. Needs the model server running (npm run julia). Reports, per
// confidence threshold: accuracy on clear cases, false nudges (confident
// off-task where on-task or ambiguous), missed drifts, unsure rate, latency.
//   node scripts/eval-decider.mjs [baseUrl] [modelId]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecider } from '../src/agent/decider.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.argv[2] || process.env.BD_DECIDER_URL || 'http://127.0.0.1:18090/v1';
const modelId = process.argv[3] || process.env.BD_DECIDER_MODEL || 'julia-1';
const { quests, cases } = JSON.parse(readFileSync(path.join(root, 'eval', 'decider', 'cases.json'), 'utf8'));

// --llm: judge with a chat model (Llama on this PC) through the pi agent's
// verdict tool instead of a decision model. It answers on-task / off-task /
// unsure with no probability, so its verdicts count as p = 1.
const LLM = process.argv.includes('--llm');
let decider;
if (LLM) {
  const { createJudge, createLlamaHandle } = await import('../src/agent/brain.js');
  const judge = createJudge({ modelHandle: await createLlamaHandle(baseUrl), mode: 'title' });
  decider = { judge: async (a) => { const t0 = Date.now(); const r = await judge.judge(a); return { ...r, choice: r.verdict, probability: r.verdict === 'unsure' ? 0 : 1, ms: Date.now() - t0 }; } };
} else {
  // Threshold 0 returns the raw top choice; thresholds are applied afterwards.
  decider = createDecider({ baseUrl, modelId, threshold: 0 });
}
const rows = [];
for (const c of cases) {
  const q = quests[c.quest];
  const r = await decider.judge({ quest: { title: q.title, tag: q.tag }, nextStep: { text: q.next_step }, sample: { app: c.app, title: c.title }, minutes: 6 });
  if (r.reason === 'local decider unavailable') { console.error(`no answer from ${baseUrl}: is the server running (npm run julia)?`); process.exit(1); }
  rows.push({ ...c, choice: r.choice, p: r.probability, ms: r.ms });
}

const at = (t) => {
  let correct = 0, clear = 0, falseNudge = 0, missed = 0, unsure = 0;
  for (const r of rows) {
    const verdict = r.choice !== 'unsure' && r.p >= t ? r.choice : 'unsure';
    if (verdict === 'unsure') unsure++;
    if (r.expected !== 'either') { clear++; if (verdict === r.expected) correct++; }
    if (verdict === 'off-task' && r.expected !== 'off-task') falseNudge++;
    if (r.expected === 'off-task' && verdict !== 'off-task') missed++;
  }
  return { threshold: t, accuracyOnClear: +(correct / clear).toFixed(2), falseNudges: falseNudge, missedDrifts: missed, unsure };
};
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const report = {
  model: modelId, baseUrl, cases: rows.length, ranAt: new Date().toISOString(),
  latencyMs: { median: ms[Math.floor(ms.length / 2)], max: ms.at(-1) },
  byThreshold: [0.5, 0.6, 0.7, 0.75, 0.8, 0.9].map(at),
  wrongAtDefault: rows.filter((r) => { const v = r.choice !== 'unsure' && r.p >= 0.75 ? r.choice : 'unsure'; return r.expected !== 'either' && v !== 'unsure' && v !== r.expected; }).map((r) => ({ quest: r.quest, title: r.title, expected: r.expected, got: r.choice, p: +r.p.toFixed(2) })),
};
const out = path.join(root, 'eval', 'decider', `results-${modelId}.json`);
writeFileSync(out, JSON.stringify({ ...report, rows }, null, 2));
console.table(report.byThreshold);
console.log(`median ${report.latencyMs.median} ms, max ${report.latencyMs.max} ms per decision`);
if (report.wrongAtDefault.length) { console.log('confidently wrong at 0.75:'); console.table(report.wrongAtDefault); }
console.log(`saved ${path.relative(root, out)}`);
