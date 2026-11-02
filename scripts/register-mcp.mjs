#!/usr/bin/env node
// Kept for older notes: same as `node bin/nudgling.mjs connect claude-code [--remove]`.
import { connectClaude } from '../src/claude-connect.js';

const r = connectClaude({ remove: process.argv.includes('--remove') });
console.log(`${r.connected ? 'Registered' : 'Removed'} nudgling in ${r.file}${r.backup ? ` (backup: ${r.backup})` : ''}`);
