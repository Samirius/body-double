#!/usr/bin/env node
// Launches the real pet with a temporary data folder and port, lets it start
// its own service (cold start), drives quest -> step -> nudge -> snooze, and
// checks the report and the four screenshots. Usage: npm run test:pet [outDir]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron');
// --record also saves demo clips (frame sequences) into <outDir>/clips.
const record = process.argv.includes('--record');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const out = path.resolve(outArg || mkdtempSync(path.join(tmpdir(), 'bd-pet-shots-')));
const dataDir = mkdtempSync(path.join(tmpdir(), 'bd-pet-data-'));
const env = { ...process.env, BD_DATA_DIR: dataDir, BD_PORT: String(48100 + Math.floor(Math.random() * 400)), BD_NOTIFY: 'off', BD_PROVIDER: 'none', BD_DECIDER: 'off', BD_WRITER: 'off', BD_SAMPLE_SECONDS: '600', BD_DEBUG: '1' };
const r = spawnSync(electron, ['src/pet/main.js', '--selftest', out, ...(record ? ['--record'] : [])], { env, timeout: record ? 240_000 : 120_000, stdio: 'inherit' });
const report = JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8'));
const shots = ['0-pet-ask', '0-pet-plan', '1-pet-cheer', '2-pet-nudge', '3-pet-sleep', '4-panel', '5-panel-after-add', '6-pet-ring', '7-fx-bomb', '8-fx-rage', '9-pet-flow', '10-pet-side-task'].map((n) => ({ n, bytes: statSync(path.join(out, `${n}.png`)).size }));
console.log(JSON.stringify({ exit: r.status, ok: report.ok, steps: report.steps, shots, out }, null, 2));
const pass = r.status === 0 && report.ok && shots.every((s) => s.bytes > 5000);
console.log(pass ? 'PET SELFTEST PASS' : 'PET SELFTEST FAIL');
process.exit(pass ? 0 : 1);
