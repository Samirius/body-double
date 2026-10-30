#!/usr/bin/env node
// MCP server so Claude can run the companion from any conversation:
// "I'm starting Banafah", "done with that", "how am I doing?".
// Thin client of the background service (src/daemon.js); starts it if needed.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDataDir } from './core/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.BD_DATA_DIR || defaultDataDir();
const infoFile = path.join(dataDir, 'daemon.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readInfo() { try { return JSON.parse(readFileSync(infoFile, 'utf8')); } catch { return null; } }

async function call(method, route, body, { retried = false } = {}) {
  const info = readInfo();
  try {
    if (!info) throw new Error('not running');
    const res = await fetch(`http://127.0.0.1:${info.port}${route}`, { method, headers: { 'content-type': 'application/json', 'x-bd-token': info.token }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
    const json = await res.json();
    if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { fromService: true });
    return json;
  } catch (e) {
    if (e.fromService || retried) throw e;
    await startService(info?.startedAt);
    return call(method, route, body, { retried: true });
  }
}

// Start the background service detached (it outlives this MCP process) and
// wait until it has written a fresh daemon.json.
async function startService(previousStart) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'daemon.js')], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const info = readInfo();
    if (info && info.startedAt !== previousStart) return;
  }
  throw new Error('companion service did not start (check node and npm install in the body-double folder)');
}

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const tool = (name, description, shape, fn) => server.registerTool(name, { description, inputSchema: shape }, async (args) => {
  try { return text(await fn(args || {})); } catch (e) { return { ...text(`error: ${e.message}`), isError: true }; }
});

const server = new McpServer({ name: 'focus-companion', version: '0.1.0' });

tool('companion_status', 'Current focus state: active quest and next step, level and XP progress, skills, titles, streak, boss HP, nudge stats, paused or not.', {}, () => call('GET', '/status'));
tool('companion_list_quests', 'List all quests with progress and which one is active.', {}, () => call('GET', '/quests'));
tool('companion_add_quest', 'Add a quest (a goal broken into tiny steps) and by default make it active. Steps should each take under ~10 minutes; the first under 2. allow = keywords that appear in window titles/apps when working on it (e.g. "merchant center"). A deadline makes it a boss fight.', {
  title: z.string(), steps: z.array(z.string()).default([]), tag: z.string().optional().describe('Skill: Client Work, Code, Admin, Sales, Health, Creative...'),
  allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional(), deadline: z.string().optional().describe('YYYY-MM-DD'), activate: z.boolean().default(true),
}, (a) => call('POST', '/quests', a));
tool('companion_activate_quest', 'Switch the active quest by id or by part of its title.', { query: z.string() }, (a) => call('POST', '/quests/activate', a));
tool('companion_complete_step', 'Mark the next step of the active quest done. Awards XP (comeback bonus if soon after a nudge) and returns level-ups, titles, boss defeats.', {}, () => call('POST', '/steps/done'));
tool('companion_add_steps', 'Append steps to a quest (active quest if no query).', { steps: z.array(z.string()).min(1), query: z.string().optional() }, (a) => call('POST', '/steps/add', a));
tool('companion_pause', 'Pause or resume watching and nudges (e.g. during a meeting or a break).', { paused: z.boolean() }, (a) => call('POST', '/pause', a));
tool('companion_feedback', 'Record that the last nudge was wrong (its trigger becomes allowed for this quest) or that the user drifted and the companion missed it (the site/app becomes a distraction for this quest). Pass keyword if the user names the site/app. Returns what was learned; tell the user and offer to undo.', { verdict: z.enum(['wrong-nudge', 'missed-drift']), keyword: z.string().optional() }, (a) => call('POST', '/feedback', a));
tool('companion_rules', "Show the active quest's learned allow/deny keywords and the global distraction list.", {}, () => call('GET', '/rules'));
tool('companion_forget_rule', "Undo a learned rule (remove a keyword from the active quest's allow/deny lists).", { keyword: z.string() }, (a) => call('POST', '/rules/forget', a));
tool('companion_report', 'Kill-test style report: nudges, wrong ones, missed drifts, catch rate, returns.', {}, async () => (await call('GET', '/report')).report);
tool('companion_import_jarvis', "Import Samir's open JARVIS operations (work/NOW.generated.md) as quests; never duplicates.", {}, () => call('POST', '/import/jarvis', {}));

await server.connect(new StdioServerTransport());
