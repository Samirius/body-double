import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRhythm } from '../src/core/rhythm.js';
import { gitScope, tooMuchUncommitted, pageKey, scopeHint } from '../src/core/scope.js';

const MIN = 60_000;
const feed = (r, label, minutes, from = 0, extra = {}) => {
  const events = [];
  for (let i = 1; i <= minutes * 4; i++) events.push(...r.push({ at: from + i * 15_000, label, gapMs: 15_000, ...extra }));
  return events;
};

test('rhythm: flow builds a combo every 5 focused minutes and is banked (not scolded) on drift', () => {
  const r = createRhythm();
  const e = feed(r, 'on-task', 16);
  assert.deepEqual(e.map((x) => x.level), [1, 2, 3]);
  assert.equal(r.flow().level, 3);
  assert.deepEqual(feed(r, 'unclear', 3, 16 * MIN), [], 'unclear neither builds nor breaks it');
  const banked = r.push({ at: 20 * MIN, label: 'drift', gapMs: 15_000 });
  assert.deepEqual(banked, [{ type: 'flow-banked', level: 3, minutes: 16 }]);
  assert.equal(r.flow().level, 0);
});

test('rhythm: 90 active minutes trigger one hyperfocus break; a real 5-minute break resets it', () => {
  const r = createRhythm();
  assert.equal(feed(r, 'on-task', 60).filter((x) => x.type === 'hyperfocus').length, 0);
  feed(r, 'away', 6, 60 * MIN); // a real break
  assert.equal(feed(r, 'on-task', 60, 66 * MIN).filter((x) => x.type === 'hyperfocus').length, 0);
  const late = feed(r, 'unclear', 31, 126 * MIN).filter((x) => x.type === 'hyperfocus');
  assert.equal(late.length, 1, 'counts any active time, not only on-task');
});

test('rhythm: a meeting keeps it quiet for 2 more minutes', () => {
  const r = createRhythm();
  r.push({ at: 0, label: 'unclear', quiet: true });
  assert.equal(r.isQuiet(MIN), true);
  assert.equal(r.isQuiet(2 * MIN + 1), false);
});

test('scope: page keys separate jobs on the same site and merge numbered pages', () => {
  assert.equal(pageKey({ app: 'brave', title: 'Edit Page “Home” ‹ My Shop — Elementor - Brave' }), 'edit page “home”');
  assert.equal(pageKey({ app: 'brave', title: 'Orders ‹ My Shop — WooCommerce - Brave' }), 'orders');
  assert.equal(pageKey({ app: 'brave', title: 'Edit Order #1043 ‹ My Shop — WooCommerce - Brave' }), pageKey({ app: 'brave', title: 'Edit Order #1044 ‹ My Shop — WooCommerce - Brave' }));
  assert.equal(pageKey({ app: 'code', title: 'checkout.js - shop - Visual Studio Code' }), 'checkout.js');
});

test('scope: "while you\'re at it, also add..." reads as creep; a plain fix does not', () => {
  assert.equal(scopeHint("while you're at it, also add a dark mode"), 'creep');
  assert.equal(scopeHint('can we add a new settings page'), 'creep');
  assert.equal(scopeHint('the checkout button still throws on submit, fix it'), 'unknown');
});

test('scope: a repo with many uncommitted changes and an old commit warns; a small fix does not', async () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'bd-git-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(path.join(repo, 'a.txt'), 'a\n'); git('add', '.'); git('commit', '-qm', 'init');
  writeFileSync(path.join(repo, 'a.txt'), 'a\nfix\n');
  const small = await gitScope(repo, Date.now() + 60 * MIN);
  assert.deepEqual({ files: small.files, lines: small.lines }, { files: 1, lines: 1 });
  assert.equal(tooMuchUncommitted(small), false);
  for (let i = 0; i < 9; i++) writeFileSync(path.join(repo, `f${i}.js`), 'x\n'.repeat(40));
  const big = await gitScope(repo, Date.now() + 60 * MIN);
  assert.equal(big.files, 10);
  assert.ok(big.lastCommitMinutes >= 59);
  assert.equal(tooMuchUncommitted(big), true);
  assert.equal(tooMuchUncommitted({ ...big, lastCommitMinutes: 10 }), false, 'a recent commit means it is being handled');
  assert.equal(await gitScope(mkdtempSync(path.join(tmpdir(), 'bd-nogit-'))), null);
});
