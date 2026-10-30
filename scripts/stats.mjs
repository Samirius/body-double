#!/usr/bin/env node
// Writes the stats page from your local data and prints where it is.
//   npm run stats                 -> %APPDATA%\body-double\stats.html
//   npm run stats -- out.html [--json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultDataDir } from '../src/core/store.js';
import { buildStats, renderStatsHtml } from '../src/stats.js';

const dir = process.env.BD_DATA_DIR || defaultDataDir();
const args = process.argv.slice(2);
const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(dir, 'stats.html'));
const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
const stats = buildStats(state);
writeFileSync(out, renderStatsHtml(stats));
if (args.includes('--json')) writeFileSync(out.replace(/\.html?$/i, '') + '.json', JSON.stringify(stats, null, 2));
console.log(`stats: ${out}`);
console.log(`steps ${stats.totals.steps} · drift nudges ${stats.totals.driftNudges} · turned around ${stats.totals.returns} · wrong ${stats.totals.wrongNudges} · missed ${stats.totals.missedDrifts}`);
