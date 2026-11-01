import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectClaude, claudeConnected } from '../src/claude-connect.js';

test('connect claude: adds one entry, keeps the rest, backs up, and can be undone', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bd-claude-'));
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
  assert.equal(claudeConnected({ home }), false);
  const r = connectClaude({ home, execPath: 'C:\\electron.exe', electron: true });
  const cfg = JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.equal(cfg.theme, 'dark');
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ['nudgling', 'other']);
  assert.equal(cfg.mcpServers.nudgling.command, 'C:\\electron.exe');
  assert.deepEqual(cfg.mcpServers.nudgling.env, { ELECTRON_RUN_AS_NODE: '1' });
  assert.match(cfg.mcpServers.nudgling.args[0], /mcp\.js$/);
  assert.ok(r.backup && readdirSync(home).some((f) => f.startsWith('.claude.json.bak-')));
  assert.equal(claudeConnected({ home }), true);
  connectClaude({ home, remove: true });
  assert.equal(claudeConnected({ home }), false);
  assert.ok(JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.other);
});

test('connect claude: works when there is no config yet', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'bd-claude-'));
  const r = connectClaude({ home, execPath: 'node', electron: false });
  assert.equal(r.backup, null);
  assert.deepEqual(JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.nudgling.env, {});
});
