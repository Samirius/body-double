#!/usr/bin/env node
// Registers (or with --remove, unregisters) the nudgling MCP server in
// your user-level Claude Code config (~/.claude.json). Same as the HUD's
// "Connect Claude" button. Makes a timestamped backup first.
//   node scripts/register-mcp.mjs            (add)
//   node scripts/register-mcp.mjs --remove   (remove)
import { connectClaude } from '../src/claude-connect.js';

const r = connectClaude({ remove: process.argv.includes('--remove') });
console.log(`${r.connected ? 'Registered' : 'Removed'} nudgling in ${r.file}`);
if (r.backup) console.log(`Backup: ${r.backup}`);
console.log(`MCP servers now: ${r.servers.join(', ')}`);
if (r.connected) console.log('Start a new Claude Code session to load the companion_* tools.');
