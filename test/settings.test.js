import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, makeQuest } from '../src/core/store.js';
import { createBrain } from '../src/agent/brain.js';
import { createCompanion } from '../src/companion.js';

function setup(startIso) {
  const store = createStore(mkdtempSync(path.join(tmpdir(), 'bd-set-')));
  let clock = Date.parse(startIso);
  const said = [], statuses = [];
  const c = createCompanion({ store, watcher: { sample: async () => ({ idleSeconds: 0, app: 'brave', title: 'Funny cats - YouTube - Brave' }) }, ui: { nudge: async (n) => said.push(n), gameEvents: () => {}, status: (s) => statuses.push(s) }, makeBrain: (cb) => createBrain(cb), timing: { morningHour: 24, eveningHour: 24 }, driftOptions: { driftAfterSeconds: 60 }, now: () => clock });
  c.addQuest(makeQuest({ title: 'Banafah verification', steps: ['Add store hours'] }));
  const run = async (minutes) => { for (let i = 0; i < minutes * 4; i++) { await c.tick(); clock += 15_000; } };
  return { c, said, statuses, run };
}

test('settings: values are validated and clamped, and every client hears the change', () => {
  const h = setup('2026-11-03T10:00:00');
  const s = h.c.updateSettings({ driftAfterSeconds: 5, volume: 250, quietFrom: 22, quietTo: '7', sound: 0, junk: 'x' });
  assert.equal(s.driftAfterSeconds, 90);
  assert.equal(s.volume, 100);
  assert.deepEqual([s.quietFrom, s.quietTo, s.sound, s.fx], [22, 7, false, true]);
  assert.equal('junk' in s, false);
  assert.ok(h.statuses.some((x) => x.settings?.volume === 100));
  assert.equal(h.c.status().settings.quietFrom, 22);
});

test('settings: quiet hours across midnight keep drift nudges silent; outside them it speaks', async () => {
  const night = setup('2026-11-03T23:00:00');
  night.c.updateSettings({ quietFrom: 22, quietTo: 7 });
  await night.run(6);
  assert.equal(night.said.filter((n) => n.kind === 'drift').length, 0);
  const day = setup('2026-11-03T15:00:00');
  day.c.updateSettings({ quietFrom: 22, quietTo: 7 });
  await day.run(6);
  assert.ok(day.said.some((n) => n.kind === 'drift'));
});
