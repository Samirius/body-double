import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect, isConnected, detectClients, clients } from '../src/connect.js';

const spec = { command: 'C:\\node\\node.exe', args: ['C:\\nudgling\\src\\mcp.js'], env: {} };
const home = () => mkdtempSync(path.join(tmpdir(), 'bd-connect-'));
const env = (h) => ({ APPDATA: path.join(h, 'AppData', 'Roaming') });

test('connect: every agent can be connected and disconnected, with its skill, without touching other entries', () => {
  for (const client of Object.keys(clients('x'))) {
    const h = home();
    const r = connect(client, { home: h, env: env(h), spec });
    assert.equal(isConnected(client, { home: h, env: env(h) }), true, client);
    if (r.skill) assert.ok(existsSync(path.join(r.skill, 'SKILL.md')), `${client} skill`);
    connect(client, { remove: true, home: h, env: env(h), spec });
    assert.equal(isConnected(client, { home: h, env: env(h) }), false, `${client} removed`);
  }
});

test('connect: Codex TOML keeps the user\'s other tables and is idempotent', () => {
  const h = home();
  mkdirSync(path.join(h, '.codex'));
  writeFileSync(path.join(h, '.codex', 'config.toml'), 'model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "x"\n');
  connect('codex', { home: h, spec });
  connect('codex', { home: h, spec });
  const t = readFileSync(path.join(h, '.codex', 'config.toml'), 'utf8');
  assert.equal((t.match(/\[mcp_servers\.nudgling\]/g) || []).length, 1);
  assert.match(t, /model = "gpt-6"/);
  assert.match(t, /\[mcp_servers\.other\]\ncommand = "x"/);
  assert.match(t, /args = \["C:\\\\nudgling\\\\src\\\\mcp\.js"\]/);
  connect('codex', { remove: true, home: h, spec });
  const after = readFileSync(path.join(h, '.codex', 'config.toml'), 'utf8');
  assert.doesNotMatch(after, /nudgling/);
  assert.match(after, /\[mcp_servers\.other\]/);
});

test('connect: Hermes YAML adds under an existing mcp_servers map and removes cleanly', () => {
  const h = home();
  mkdirSync(path.join(h, '.hermes'));
  writeFileSync(path.join(h, '.hermes', 'config.yaml'), 'model: hermes-4\nmcp_servers:\n  github:\n    command: npx\n    args: ["gh-mcp"]\nterminal:\n  backend: local\n');
  connect('hermes', { home: h, spec: { ...spec, env: { ELECTRON_RUN_AS_NODE: '1' } } });
  const t = readFileSync(path.join(h, '.hermes', 'config.yaml'), 'utf8');
  assert.match(t, /mcp_servers:\n {2}nudgling:\n {4}command: "C:\\\\node\\\\node.exe"\n {4}args: \[.*\]\n {4}env:\n {6}ELECTRON_RUN_AS_NODE: "1"\n {2}github:/);
  connect('hermes', { remove: true, home: h, spec });
  const after = readFileSync(path.join(h, '.hermes', 'config.yaml'), 'utf8');
  assert.doesNotMatch(after, /nudgling/);
  assert.match(after, /mcp_servers:\n {2}github:\n {4}command: npx/);
  assert.match(after, /terminal:\n {2}backend: local/);
});

test('connect: OpenClaw nests under mcp.servers; a config that is not plain JSON is refused, not guessed', () => {
  const h = home();
  mkdirSync(path.join(h, '.openclaw'));
  writeFileSync(path.join(h, '.openclaw', 'openclaw.json'), JSON.stringify({ agents: { defaults: {} }, mcp: { servers: { fetch: { command: 'npx' } } } }));
  connect('openclaw', { home: h, spec });
  const cfg = JSON.parse(readFileSync(path.join(h, '.openclaw', 'openclaw.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg.mcp.servers).sort(), ['fetch', 'nudgling']);
  assert.ok(cfg.agents);
  writeFileSync(path.join(h, '.openclaw', 'openclaw.json'), '{ // json5 comment\n mcp: {} }');
  assert.throws(() => connect('openclaw', { home: h, spec }));
});

test('connect: detects which agents are installed from their config folders', () => {
  const h = home();
  mkdirSync(path.join(h, '.codex'));
  mkdirSync(path.join(h, '.hermes'));
  writeFileSync(path.join(h, '.claude.json'), '{}');
  assert.deepEqual(detectClients({ home: h, env: env(h) }).sort(), ['claude-code', 'codex', 'hermes']);
});
