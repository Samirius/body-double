#!/usr/bin/env node
// Registers (or with --remove, unregisters) the nudgling MCP server in
// your user-level Claude Code config (~/.claude.json), so Claude can run the
// companion from any conversation. Makes a timestamped backup first and only
// touches the one "nudgling" entry. Run it yourself:
//   node scripts/register-mcp.mjs            (add)
//   node scripts/register-mcp.mjs --remove   (remove)
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(homedir(), '.claude.json');
const mcpScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp.js');
const remove = process.argv.includes('--remove');

const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
if (existsSync(file)) copyFileSync(file, backup);

config.mcpServers ||= {};
if (remove) delete config.mcpServers['nudgling'];
else config.mcpServers['nudgling'] = { type: 'stdio', command: process.execPath, args: [mcpScript], env: {} };

writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2));
renameSync(`${file}.tmp`, file);
console.log(`${remove ? 'Removed' : 'Registered'} nudgling in ${file}`);
if (existsSync(backup)) console.log(`Backup: ${backup}`);
console.log(`MCP servers now: ${Object.keys(config.mcpServers).join(', ')}`);
console.log(remove ? '' : 'Start a new Claude Code session to load the companion_* tools.');
