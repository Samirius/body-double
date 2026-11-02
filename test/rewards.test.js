import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRewards, applyReward, settle, equip, mood, weekRecap, ACHIEVEMENTS } from '../src/core/rewards.js';

const at = Date.parse('2026-11-03T10:00:00');

test('rewards: good habits raise happiness and unlock achievements with cosmetics', () => {
  let r = newRewards();
  let all = [];
  const add = (ev) => { const x = applyReward(r, ev, at); r = x.rewards; all.push(...x.events); };
  add({ type: 'park' });
  assert.deepEqual(all.map((e) => e.id), ['first-park']);
  add({ type: 'perfect' });
  assert.equal(all.at(-1).id, 'clean-run');
  assert.equal(all.at(-1).cosmetic, 'shades');
  assert.deepEqual(r.unlocked, ['shades']);
  for (let i = 0; i < 6; i++) add({ type: 'flow', level: i + 1 });
  assert.ok(r.achievements.includes('in-the-zone'));
  add({ type: 'boss', quest: 'Banafah verification' });
  assert.equal(r.trophies[0].quest, 'Banafah verification');
  assert.equal(r.happiness, 100, 'capped');
  assert.equal(mood(r.happiness), 'glowing');
  // Each achievement fires once.
  add({ type: 'park' });
  assert.equal(all.filter((e) => e.id === 'first-park').length, 1);
});

test('rewards: happiness settles toward 50 and never goes sad', () => {
  const r = { ...newRewards(), happiness: 80 };
  assert.equal(settle(r, 5).happiness, 70);
  assert.equal(settle(r, 100).happiness, 50);
  assert.equal(settle({ ...r, happiness: 50 }, 100).happiness, 50);
  assert.equal(mood(50), 'content');
});

test('rewards: only unlocked cosmetics can be worn; 3 sessions in a day is Triple Play', () => {
  let r = newRewards();
  assert.throws(() => equip(r, 'crown'));
  for (let i = 0; i < 3; i++) r = applyReward(r, { type: 'session' }, at + i * 3_600_000).rewards;
  assert.ok(r.achievements.includes('triple-play'));
  r = applyReward(r, { type: 'boss' }, at).rewards;
  assert.equal(equip(r, 'crown').equipped, 'crown');
  assert.equal(equip(r, null).equipped, null);
  assert.equal(ACHIEVEMENTS.length, 10);
});

test('rewards: the weekly recap counts wins from the last 7 days only', () => {
  const day = 86_400_000;
  const log = [
    { at: at - 9 * day, type: 'step-done', xp: 10 },
    { at: at - 2 * day, type: 'step-done', xp: 10 },
    { at: at - 2 * day, type: 'step-done', xp: 15, events: ['xp', 'boss-defeated'] },
    { at: at - day, type: 'step-done', xp: 10 },
    { at: at - day, type: 'flow-banked', minutes: 35 },
    { at: at - day, type: 'session-done', minutes: 25, perfect: true },
    { at: at - day, type: 'returned' },
    { at: at - day, type: 'parked' },
  ];
  const w = weekRecap(log, at);
  assert.deepEqual({ steps: w.steps, xp: w.xp, flow: w.flowMinutes, sessions: w.sessions, perfect: w.perfectSessions, comebacks: w.comebacks, parked: w.parked, bosses: w.bosses }, { steps: 3, xp: 35, flow: 35, sessions: 1, perfect: 1, comebacks: 1, parked: 1, bosses: 1 });
  assert.equal(w.bestDay.steps, 2);
});
