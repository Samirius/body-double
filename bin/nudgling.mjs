#!/usr/bin/env node
// nudgling: the companion from any shell or AI agent (no MCP needed).
//   nudgling status | today | quests
//   nudgling start "Fix the checkout bug" [--steps "Reproduce it; Find the line; Fix; Test"] [--repo .] [--deadline 2026-11-06]
//   nudgling done                      finish the next step
//   nudgling scope "also add dark mode" is this new request part of the quest?
//   nudgling park "idea for later"     save a side idea to the vault
//   nudgling focus [25|50|stop]        focus session with the timer ring
//   nudgling pause [minutes] | resume
//   nudgling connect [agent|all] [--remove]   add MCP + skill to claude-code, claude-desktop, codex, cursor, openclaw, hermes, pi
//   nudgling agents                    which agents are installed / connected
// Output is JSON (easy for agents to read); errors go to stderr with exit code 1.
import path from 'node:path';
import { createClient } from '../src/client.js';
import { connect, detectClients, isConnected, clients } from '../src/connect.js';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const has = (name) => rest.includes(`--${name}`);
const words = () => rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !['--remove'].includes(rest[i - 1]))).join(' ').trim();
const out = (x) => console.log(JSON.stringify(x, null, 2));

async function main() {
  if (cmd === 'connect') {
    const target = words() || 'all';
    const list = target === 'all' ? detectClients() : [target];
    if (!list.length) return out({ connected: [], note: 'No known agent found. Use the commands above from any shell instead.' });
    return out(list.map((c) => { try { return connect(c, { remove: has('remove') }); } catch (e) { return { client: c, error: e.message }; } }));
  }
  if (cmd === 'agents') {
    const installed = new Set(detectClients());
    return out(Object.entries(clients()).map(([id, c]) => ({ id, name: c.label, installed: installed.has(id), connected: isConnected(id) })));
  }
  const { call } = createClient();
  switch (cmd) {
    case 'status': return out(await call('GET', '/status'));
    case 'today': return out(await call('GET', '/today'));
    case 'quests': return out(await call('GET', '/quests'));
    case 'start': {
      const title = words();
      if (!title) throw new Error('usage: nudgling start "<what you are working on>" [--steps "a; b; c"] [--repo .] [--deadline YYYY-MM-DD]');
      const steps = (flag('steps') || '').split(';').map((s) => s.trim()).filter(Boolean);
      const repo = flag('repo') ? path.resolve(flag('repo')) : undefined;
      const added = await call('POST', '/quests', { title, steps, repo, deadline: flag('deadline'), allow: (flag('allow') || '').split(',').map((s) => s.trim()).filter(Boolean) });
      if (!steps.length) await call('POST', '/quests/plan', {});
      return out(added);
    }
    case 'done': return out(await call('POST', '/steps/done'));
    case 'scope': return out(await call('POST', '/scope/check', { request: words() }));
    case 'park': return out(await call('POST', '/vault/park', { note: words() || undefined }));
    case 'focus': return out(await call('POST', '/session', words() === 'stop' ? { action: 'stop' } : { action: 'start', minutes: Number(words()) || 25 }));
    case 'pause': return out(await call('POST', '/pause', { paused: true, minutes: Number(words()) || undefined }));
    case 'resume': return out(await call('POST', '/pause', { paused: false }));
    default:
      console.log((await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  }
}

main().catch((e) => { console.error(`nudgling: ${e.message}`); process.exit(1); });
