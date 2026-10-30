import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classify } from '../src/core/classifier.js';
import { createDriftTracker } from '../src/core/drift.js';
import { newGameState, completeStep, levelFromXp, xpForLevel, bossHp, petStage } from '../src/core/game.js';
import { createStore, makeQuest } from '../src/core/store.js';

const quest = { title: 'Banafah verification', allow: ['merchant center', 'woocommerce', 'banafah'], deny: [] };
const s = (app, title, idleSeconds = 0) => ({ app, title, idleSeconds });

test('classifier: quest keywords, distractions, away, unclear', () => {
  assert.equal(classify(s('brave', 'Merchant Center - Products'), quest).label, 'on-task');
  assert.equal(classify(s('brave', 'Funny cats - YouTube'), quest).label, 'drift');
  assert.equal(classify(s('code', 'index.js - VS Code', 600), quest).label, 'away');
  assert.equal(classify(s('notepad', 'notes.txt'), quest).label, 'unclear');
  assert.equal(classify(s('explorer', 'Downloads'), quest).label, 'unclear');
  // quest allow-list beats the global distraction list
  assert.equal(classify(s('brave', 'Course edit - YouTube Studio'), { allow: ['youtube studio'] }).label, 'on-task');
});

test('drift: nudges once after the threshold, then only after the cooldown; tracks return', () => {
  const d = createDriftTracker({ driftAfterSeconds: 180, cooldownSeconds: 300 });
  const at = (sec) => 1_000_000 + sec * 1000;
  const ev = (label, sec) => d.push({ label, at: at(sec) });
  assert.deepEqual(ev('drift', 0), []);
  assert.deepEqual(ev('drift', 120), []);
  assert.equal(ev('drift', 180)[0].type, 'drift');
  assert.deepEqual(ev('drift', 240), []); // cooldown
  assert.deepEqual(ev('unclear', 250), []); // alt-tab does not reset the episode
  const second = ev('drift', 480);
  assert.equal(second[0].nudgeNumber, 2);
  const back = ev('on-task', 540);
  assert.equal(back[0].type, 'returned');
  assert.equal(back[0].secondsAfterNudge, 60);
  assert.deepEqual(ev('drift', 600), []); // new episode starts fresh
});

test('drift: never nudges while away', () => {
  const d = createDriftTracker({ driftAfterSeconds: 60 });
  const events = [0, 60, 120, 600].flatMap((sec) => d.push({ label: 'away', at: sec * 1000 }));
  assert.deepEqual(events.map((e) => e.type), ['away']);
});

test('game: level curve and pet stages', () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(xpForLevel(2)), 2);
  assert.equal(levelFromXp(xpForLevel(2) - 1), 1);
  assert.equal(petStage(1), 1);
  assert.equal(petStage(5), 2);
  assert.equal(petStage(20), 4);
});

test('game: step XP, comeback bonus, first title, boss kill', () => {
  let game = newGameState();
  let q = makeQuest({ title: 'Banafah', tag: 'Client Work', steps: ['open MC', 'upload store info'], deadline: '2026-11-06' });
  const t0 = Date.parse('2026-11-01T10:00:00');
  let r = completeStep(game, { quest: q, stepId: q.steps[0].id, at: t0 });
  assert.equal(r.events[0].amount, 10);
  assert.ok(r.events.some((e) => e.type === 'title' && e.id === 'first-step'));
  assert.deepEqual(bossHp(r.quest), { hp: 1, max: 2 });
  game = r.game; q = r.quest;
  r = completeStep(game, { quest: q, stepId: q.steps[1].id, at: t0 + 60_000, lastNudgeAt: t0 });
  assert.equal(r.events[0].amount, 15 + 50); // comeback x1.5 + boss kill
  assert.ok(r.events.some((e) => e.type === 'boss-defeated'));
  assert.ok(r.events.some((e) => e.type === 'title' && e.id === 'boss-slayer'));
  assert.equal(r.game.xp.skills['Client Work'], 75);
  // completing an already-done step changes nothing
  assert.equal(completeStep(r.game, { quest: r.quest, stepId: q.steps[1].id, at: t0 }).events.length, 0);
});

test('game: streak grows daily, a shield covers one missed day, never resets to zero', () => {
  let game = newGameState();
  const days = ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-09'];
  const streaks = [];
  for (const day of days) {
    const q = makeQuest({ title: 'x', steps: ['a'] });
    const r = completeStep(game, { quest: q, stepId: q.steps[0].id, at: Date.parse(`${day}T12:00:00`) });
    game = r.game; streaks.push(game.streak.days);
  }
  assert.deepEqual(streaks, [1, 2, 3, 1]); // 11-04 missed: shield; 11-06..08 missed: restart at 1
});

test('store: atomic save survives reload', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bd-store-'));
  const store = createStore(dir);
  const q = makeQuest({ title: 'Ship', steps: ['one'] });
  store.update((st) => ({ ...st, quests: [q], activeQuestId: q.id }));
  store.log('drift', { reason: 'test' });
  const again = createStore(dir);
  assert.equal(again.activeQuest().title, 'Ship');
  assert.equal(again.get().log.at(-1).type, 'drift');
  assert.doesNotThrow(() => JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')));
});
