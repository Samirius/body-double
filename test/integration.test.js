import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseNow, jarvisQuests } from '../src/jarvis.js';

const NOW = `# NOW
## In Progress
### P1 · OP-0024 — Four-path experiment
- **Owner / lane:** samir / commercial
- **Updated / review:** 2026-10-25 / 2026-11-22
- **Next action:** Log the weekly numbers every Friday.
## Open
### P2 · OP-0023 — Small client follow-ups
- **Owner / lane:** samir / clients
- **Next action:** Message AtomicKaizen about the PayPal add-on.
### P1 · OP-0009 — Agent work
- **Owner / lane:** jaafar / brain
- **Next action:** Not Samir's.
## Done
### P1 · OP-0003 — Old
- **Owner / lane:** samir / brain
- **Next action:** Already done.
`;

test('jarvis: imports only Samir\'s open items, once', () => {
  assert.deepEqual(parseNow(NOW).map((i) => i.id), ['OP-0024', 'OP-0023', 'OP-0003']); // parser alone
  const qs = jarvisQuests(NOW);
  assert.deepEqual(qs.map((q) => q.source), ['jarvis:OP-0024', 'jarvis:OP-0023']); // Done section excluded
  assert.equal(qs[0].tag, 'Sales');
  assert.equal(qs[0].deadline, '2026-11-22');
  assert.equal(qs[1].steps[0].text, 'Message AtomicKaizen about the PayPal add-on.');
  assert.equal(jarvisQuests(NOW, qs).length, 0);
});

// Full path Claude will use: MCP client -> mcp.js -> auto-started daemon -> companion.
test('mcp: tools drive the background service end to end', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bd-int-'));
  const nowFile = path.join(dataDir, 'NOW.md');
  writeFileSync(nowFile, NOW);
  const env = { ...process.env, BD_DATA_DIR: dataDir, BD_PORT: String(47900 + Math.floor(Math.random() * 90)), BD_JARVIS_NOW: nowFile, BD_PROVIDER: 'none', BD_SAMPLE_SECONDS: '600', BD_NOTIFY: 'off' };
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/mcp.js'], env }));
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, r.content[0].text); return r.content[0].text; };
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('companion_add_quest') && names.includes('companion_import_jarvis'));
    await call('companion_add_quest', { title: 'Banafah verification', steps: ['Add store hours', 'Request review'], tag: 'Client Work', deadline: '2026-11-06', allow: ['merchant center'] });
    const done = JSON.parse(await call('companion_complete_step'));
    assert.equal(done.events[0].amount, 10);
    assert.deepEqual(done.status.quest.boss, { hp: 1, max: 2 });
    const today = JSON.parse(await call('companion_today'));
    assert.equal(today.steps, 1);
    assert.equal(today.xp, 10);
    const imported = JSON.parse(await call('companion_import_jarvis'));
    assert.equal(imported.added.length, 2);
    assert.equal(JSON.parse(await call('companion_list_quests')).length, 3);
    await call('companion_activate_quest', { query: 'four-path' });
    assert.match(JSON.parse(await call('companion_status')).quest.title, /Four-path/);
    await call('companion_feedback', { verdict: 'missed-drift' });
    assert.match(await call('companion_report'), /missed drifts reported: 1/);
  } finally {
    await client.close();
    // stop the detached service started for this test
    const info = JSON.parse((await import('node:fs')).readFileSync(path.join(dataDir, 'daemon.json'), 'utf8'));
    try { process.kill(info.pid); } catch { /* already gone */ }
  }
});
