#!/usr/bin/env node
// Adds (or with --remove, removes) the companion's UserPromptSubmit hook in
// your user-level Claude Code settings (~/.claude/settings.json). Backs the
// file up first and touches only this one hook. Run it yourself:
//   node scripts/register-hook.mjs   |   node scripts/register-hook.mjs --remove
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(homedir(), '.claude', 'settings.json');
const hook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'claude-hook.mjs');
const command = `"${process.execPath}" "${hook}"`;
const remove = process.argv.includes('--remove');
mkdirSync(path.dirname(file), { recursive: true });
const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
if (existsSync(file)) copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
settings.hooks ||= {};
const groups = (settings.hooks.UserPromptSubmit || [])
  .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('claude-hook.mjs')) }))
  .filter((g) => g.hooks.length);
if (!remove) groups.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
if (groups.length) settings.hooks.UserPromptSubmit = groups; else delete settings.hooks.UserPromptSubmit;
writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2));
renameSync(`${file}.tmp`, file);
console.log(`${remove ? 'Removed' : 'Added'} the nudgling chat hook in ${file}. New sessions pick it up.`);
