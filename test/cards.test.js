import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';
import { createCards, kickoffPrompt } from '../src/cards.js';

function setup(window = () => ({ app: 'code', title: 'checkout.js - shop - Visual Studio Code' })) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-cards-')));
  let clock = Date.parse('2026-11-03T10:00:00');
  const said = [], game = [], opened = [];
  const ui = { nudge: async (n) => said.push(n), gameEvents: (e) => game.push(...e), status: () => {} };
  const companion = createCompanion({ store, ui, watcher: { sample: async () => ({ idleSeconds: 0, ...window() }) }, makeBrain: (cb) => createBrain(cb), timing: { morningHour: 24, eveningHour: 24 }, driftOptions: { driftAfterSeconds: 60 }, now: () => clock });
  const launcher = { claudeApp: () => opened.push(['claude']) > 0, clipboard: (t) => opened.push(['clip', t]) > 0, url: (u) => opened.push(['url', u]) > 0, folder: (d) => !!d && opened.push(['folder', d]) > 0 };
  const cards = createCards({ store, companion, ui, launcher });
  const run = async (minutes) => { for (let i = 0; i < minutes * 4; i++) { await companion.tick(); clock += 15_000; } };
  return { store, companion, cards, said, game, opened, run };
}

test('cards: an unknown card asks what it should do; once set, a tap does it every time', async () => {
  const h = setup();
  h.companion.addQuest(makeQuest({ title: 'Fix the checkout bug', steps: ['Reproduce it', 'Fix line 40'] }));
  const first = await h.cards.tap('04:a3:2b:91');
  assert.deepEqual(first, { known: false, id: '04A32B91' });
  assert.equal(h.said.at(-1).kind, 'card-new');
  assert.equal(h.cards.assign({ action: 'done' }).action, 'done');
  const r = await h.cards.tap('04A32B91');
  assert.equal(r.events[0].type, 'xp');
  assert.equal(h.cards.list().cards[0].action, 'done');
  assert.throws(() => h.cards.assign({ id: 'FF', action: 'explode' }));
});

test('cards: a project card starts the work: quest active, focus ring, Claude opened with a kickoff prompt, links and folder', async () => {
  const h = setup();
  const shop = makeQuest({ title: 'Edit the Elementor home page', steps: ['Change the hero text'], repo: process.cwd() });
  h.companion.addQuest(shop);
  h.companion.editQuest(shop.id, { links: ['https://myshop.example/wp-admin/', 'javascript:alert(1)'] });
  h.companion.addQuest(makeQuest({ title: 'Something else' }));
  h.cards.assign({ id: 'AA11', action: 'quest', questId: shop.id });
  const r = await h.cards.tap('AA11');
  assert.equal(r.quest, 'Edit the Elementor home page');
  assert.equal(h.store.activeQuest().id, shop.id);
  assert.equal(h.companion.status().session.kind, 'focus');
  assert.deepEqual(h.opened.map((o) => o[0]), ['claude', 'clip', 'url', 'folder']);
  assert.match(h.opened[1][1], /I'm working on: Edit the Elementor home page\. Next step: Change the hero text\./);
  assert.equal(h.opened[2][1], 'https://myshop.example/wp-admin/', 'only http(s) links are kept');
  assert.match(h.said.at(-1).nextAction, /Paste it/);
});

test('card lock: past the allowance, a pulse every minute until back on task or the BREAK card is tapped', async () => {
  let w = { app: 'brave', title: 'Funny cats - YouTube - Brave' };
  const h = setup(() => w);
  h.companion.addQuest(makeQuest({ title: 'Fix the checkout bug', steps: ['Reproduce it'] }));
  h.companion.updateSettings({ cardLock: true });
  h.cards.assign({ id: 'BB22', action: 'break' }); // no pending card: explicit id
  await h.run(5);
  const pulses = () => h.game.filter((e) => e.type === 'lock-pulse');
  assert.ok(pulses().length >= 2, `pulses: ${pulses().length}`);
  assert.equal(pulses()[0].where, 'youtube');
  const before = pulses().length;
  await h.cards.tap('BB22'); // a physical move buys 10 minutes
  assert.equal(h.companion.status().paused, true);
  await h.run(5);
  assert.equal(pulses().length, before, 'quiet while the card snooze runs');
  w = { app: 'code', title: 'checkout.js - shop - Visual Studio Code' };
  h.companion.setPaused(false);
  await h.run(3);
  assert.equal(pulses().length, before, 'back on task: no pulses');
});

test('card lock is opt-in: off by default, no pulses', async () => {
  const h = setup(() => ({ app: 'brave', title: 'Funny cats - YouTube - Brave' }));
  h.companion.addQuest(makeQuest({ title: 'Fix the checkout bug' }));
  await h.run(6);
  assert.equal(h.game.filter((e) => e.type === 'lock-pulse').length, 0);
});

test('cards: the kickoff prompt carries the quest, the step and the scope rule', () => {
  const p = kickoffPrompt({ title: 'Fix the checkout bug', repo: 'C:\\shop' }, { text: 'Reproduce it' });
  assert.match(p, /Fix the checkout bug.*Reproduce it.*C:\\shop.*scope/);
});
