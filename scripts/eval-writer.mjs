#!/usr/bin/env node
// Measures the nudge writer (Llama on this PC by default) on fixed events:
// does it call the nudge tool, keep to the rules (short, names the quest, one
// concrete next action), and how fast. Writes eval/writer/results-<model>.json.
//   npm run eval:writer [-- baseUrl]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrain, createLlamaHandle } from '../src/agent/brain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.argv[2] || process.env.BD_LLAMA_URL || 'http://127.0.0.1:18091/v1';
const handle = await createLlamaHandle(baseUrl);
const stats = { sent: 4, returned: 3, returnSeconds: [40, 75, 120] };
const banafah = { title: 'Banafah verification', tag: 'Client Work', deadline: '2026-11-06' };
const CASES = [
  { quest: banafah, nextStep: { text: 'Upload the storefront photo' }, event: { type: 'drift', driftedSeconds: 240, nudgeNumber: 1, reason: 'matches distraction "youtube"' } },
  { quest: banafah, nextStep: { text: 'Upload the storefront photo' }, event: { type: 'drift', driftedSeconds: 600, nudgeNumber: 2, reason: 'matches distraction "x.com"' } },
  { quest: { title: 'White Friday email', tag: 'Sales' }, nextStep: { text: 'Open last year\'s email' }, event: { type: 'returned', secondsAfterNudge: 45 } },
  { quest: { title: 'Fix the checkout bug', tag: 'Code' }, nextStep: { text: 'Fix the checkout and payment flow' }, event: { type: 'stuck', onTaskSeconds: 1800 } },
  { quest: banafah, nextStep: { text: 'Add store hours' }, event: { type: 'morning', summary: 'Banafah is due in 5 days; 2 of 6 steps done.' } },
  { quest: banafah, nextStep: { text: 'Add store hours' }, event: { type: 'evening', summary: 'Done today: 3 steps, 1 comeback.' } },
  { quest: null, nextStep: null, event: { type: 'drift', driftedSeconds: 300, nudgeNumber: 1, reason: 'matches distraction "reddit"' } },
  { quest: { title: 'Hackathon demo video', tag: 'Creative' }, nextStep: { text: 'Record the first 20 seconds' }, event: { type: 'chat', reason: 'asking about a new startup idea' } },
];

const rows = [];
for (const c of CASES) {
  const started = Date.now();
  const out = { nudge: null, source: null, split: null, errors: [] };
  const brain = createBrain({
    modelHandles: [handle],
    onNudge: async (n, source) => { out.nudge = n; out.source = source; },
    onSplit: async (steps) => { out.split = steps; },
    log: (t, d) => out.errors.push(d.error),
  });
  await brain.handle({ quest: c.quest, nextStep: c.nextStep, event: c.event, stats });
  const n = out.nudge || {};
  const text = `${n.message || ''} ${n.nextAction || ''}`;
  const row = {
    event: c.event.type, quest: c.quest?.title || null,
    byModel: out.source === `model:${handle.model.id}`,
    message: n.message, nextAction: n.nextAction, split: out.split,
    short: (n.message || '').length <= 200 && (n.nextAction || '').length <= 120,
    namesQuest: !c.quest || text.toLowerCase().includes(c.quest.title.toLowerCase().split(' ')[0]),
    noXpClaims: !/\b\d+\s*xp\b/i.test(text),
    ms: Date.now() - started, errors: out.errors,
  };
  rows.push(row);
  console.log(`${row.byModel ? 'model   ' : 'FALLBACK'} ${row.event.padEnd(8)} ${row.ms}ms  ${n.message} -> ${n.nextAction}${out.split ? `  [split: ${out.split.join(' / ')}]` : ''}`);
}
const pct = (k) => Math.round((rows.filter((r) => r[k]).length / rows.length) * 100);
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const summary = { model: handle.model.id, baseUrl, ranAt: new Date().toISOString(), cases: rows.length, byModelPct: pct('byModel'), shortPct: pct('short'), namesQuestPct: pct('namesQuest'), noXpClaimsPct: pct('noXpClaims'), medianMs: ms[Math.floor(ms.length / 2)], maxMs: ms[ms.length - 1] };
console.log(JSON.stringify(summary, null, 2));
mkdirSync(path.join(root, 'eval', 'writer'), { recursive: true });
writeFileSync(path.join(root, 'eval', 'writer', `results-${handle.model.id}.json`), JSON.stringify({ ...summary, rows }, null, 2));
