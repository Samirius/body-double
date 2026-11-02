import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Any agent with a shell (pi, Hermes, OpenClaw, Codex...) can drive Nudgling
// through the command line; this runs it against a throwaway service.
test('cli: start -> done -> scope -> park -> focus, with JSON out', { timeout: 60_000 }, () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bd-cli-'));
  const env = { ...process.env, BD_DATA_DIR: dataDir, BD_PORT: String(48900 + Math.floor(Math.random() * 90)), BD_PROVIDER: 'none', BD_DECIDER: 'off', BD_WRITER: 'off', BD_SAMPLE_SECONDS: '600', BD_NOTIFY: 'off' };
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['bin/nudgling.mjs', ...args], { env, encoding: 'utf8' }));
  try {
    const added = cli('start', 'Fix the checkout bug', '--steps', 'Reproduce it; Fix line 40', '--repo', '.');
    assert.equal(added.added, 'Fix the checkout bug');
    assert.equal(cli('done').events[0].type, 'xp');
    const scope = cli('scope', "while you're at it, also add a dark mode");
    assert.equal(scope.verdict, 'creep');
    assert.equal(cli('park', 'dark mode, later').note, 'dark mode, later');
    assert.equal(cli('focus', '25').kind, 'focus');
    const status = cli('status');
    assert.equal(status.quest.title, 'Fix the checkout bug');
    assert.equal(status.quest.next, 'Fix line 40');
  } finally {
    try { process.kill(JSON.parse(readFileSync(path.join(dataDir, 'daemon.json'), 'utf8')).pid); } catch { /* not started */ }
  }
});
