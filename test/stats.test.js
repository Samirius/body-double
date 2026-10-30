import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStats, renderStatsHtml } from '../src/stats.js';
import { newGameState } from '../src/core/game.js';

const at = (s) => Date.parse(s);
const state = {
  game: { ...newGameState(), xp: { total: 135, skills: { 'Client Work': 135 } }, titles: ['first-step'], streak: { days: 2, shields: 1 }, stats: { stepsDone: 3, bossesDefeated: 1, comebacksByDay: {} } },
  quests: [{ allow: ['merchant center', 'youtube'], deny: ['hacker news'] }],
  settings: { driftAfterSeconds: 210 },
  log: [
    { at: at('2026-11-02T10:05:00'), type: 'drift' },
    { at: at('2026-11-02T10:05:01'), type: 'nudge', kind: 'drift', source: 'template' },
    { at: at('2026-11-02T10:06:00'), type: 'returned', secondsAfterNudge: 59 },
    { at: at('2026-11-02T10:07:00'), type: 'step-done', xp: 15, titles: ['first-step'] },
    { at: at('2026-11-02T11:00:00'), type: 'nudge', kind: 'stuck', source: 'template' },
    { at: at('2026-11-02T15:30:00'), type: 'drift' },
    { at: at('2026-11-02T15:30:01'), type: 'nudge', kind: 'drift', source: 'model' },
    { at: at('2026-11-02T15:31:00'), type: 'feedback', verdict: 'wrong-nudge' },
    { at: at('2026-11-03T09:00:00'), type: 'step-done', xp: 60, titles: [] },
    { at: at('2026-11-03T09:10:00'), type: 'feedback', verdict: 'missed-drift' },
    { at: at('2026-11-03T09:20:00'), type: 'judged', verdict: 'off-task' },
  ],
};

test('stats: totals, per-day rows, hour histogram, sources and verdicts', () => {
  const s = buildStats(state);
  assert.deepEqual(
    { steps: s.totals.steps, xp: s.totals.xp, level: s.totals.level, driftNudges: s.totals.driftNudges, returns: s.totals.returns, median: s.totals.medianReturnSeconds, wrong: s.totals.wrongNudges, missed: s.totals.missedDrifts, rules: s.totals.learnedRules, after: s.totals.nudgeAfterSeconds, days: s.totals.daysActive },
    { steps: 2, xp: 135, level: 2, driftNudges: 2, returns: 1, median: 59, wrong: 1, missed: 1, rules: 3, after: 210, days: 2 },
  );
  assert.deepEqual(s.perDay.map((d) => [d.day, d.steps, d.xp, d.driftNudges, d.returns]), [['2026-11-02', 1, 15, 2, 1], ['2026-11-03', 1, 60, 0, 0]]);
  assert.equal(s.driftsByHour[10], 1);
  assert.equal(s.driftsByHour[15], 1);
  assert.equal(s.driftsByHour.reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(s.nudgeSources, { template: 1, model: 1 }, 'stuck nudges are not drift nudges');
  assert.equal(s.judged['off-task'], 1);
  assert.match(s.killTest, /nudges sent: 2/);
});

test('stats: page is standalone, honest, escaped, and has a table view', () => {
  const html = renderStatsHtml(buildStats({ ...state, game: { ...state.game, titles: ['<script>'] } }));
  assert.match(html, /n = 1/);
  assert.match(html, /Not a study/);
  assert.match(html, /Table view/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.ok(!html.includes('<script>'), 'user text is escaped');
  assert.ok(!/(src|href)="https?:/.test(html), 'no external resources');
});

test('stats: empty state renders without errors', () => {
  const html = renderStatsHtml(buildStats({ log: [] }));
  assert.match(html, /No activity logged yet/);
});
