#!/usr/bin/env node
// Claude Code UserPromptSubmit hook: hands the prompt to the companion so it
// can notice when a chat drifts away from the active quest. Never prints to
// stdout (that would be added to the conversation), never blocks the prompt,
// never starts the service, and always exits 0.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultDataDir } from '../src/core/store.js';

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const text = String(input.prompt || '').trim();
  const info = JSON.parse(readFileSync(path.join(process.env.BD_DATA_DIR || defaultDataDir(), 'daemon.json'), 'utf8'));
  if (text) {
    await fetch(`http://127.0.0.1:${info.port}/activity/chat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bd-token': info.token }, body: JSON.stringify({ text: text.slice(0, 2000) }), signal: AbortSignal.timeout(1500) });
  }
} catch { /* companion not running or bad input: stay silent */ }
process.exit(0);
