#!/usr/bin/env node
// Soak test: runs the real background service (real window watcher, isolated
// data folder and port, no pop-ups, no model) for N minutes with fast
// sampling, and records memory, errors, watcher restarts and data-file size
// over time. Titles are never printed or stored.
//   node scripts/soak.mjs [minutes=20] [sampleSeconds=2]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const minutes = Number(process.argv[2]) || 20;
const sampleSeconds = Number(process.argv[3]) || 2;
const dataDir = mkdtempSync(path.join(tmpdir(), 'bd-soak-'));
const env = { ...process.env, BD_DATA_DIR: dataDir, BD_PORT: String(48600 + Math.floor(Math.random() * 300)), BD_NOTIFY: 'off', BD_PROVIDER: 'none', BD_DECIDER: 'off', BD_WRITER: 'off', BD_DESK: 'off', BD_SAMPLE_SECONDS: String(sampleSeconds), BD_DRIFT_SECONDS: '60' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const svc = spawn(process.execPath, ['src/daemon.js'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
svc.stderr.on('data', (d) => { stderr += d; });
const infoFile = path.join(dataDir, 'daemon.json');
let info = null;
for (let i = 0; i < 40 && !info; i++) { await sleep(250); try { info = JSON.parse(readFileSync(infoFile, 'utf8')); } catch { /* not yet */ } }
if (!info) { console.error('service did not start', stderr); process.exit(1); }
const call = async (route) => (await fetch(`http://127.0.0.1:${info.port}${route}`, { headers: { 'x-bd-token': info.token } })).json();

// Memory of the service and of its PowerShell helper (working set, MB).
function memMB(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8', windowsHide: true });
    return Math.round(Number(out.trim()) / 1048576);
  } catch { return null; }
}
function helperPids() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${svc.pid}" | Where-Object Name -eq 'powershell.exe' | ForEach-Object ProcessId`], { encoding: 'utf8', windowsHide: true });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}

const rows = [];
const started = Date.now();
await call('/quests').catch(() => {});
await fetch(`http://127.0.0.1:${info.port}/quests`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bd-token': info.token }, body: JSON.stringify({ title: 'Soak quest', steps: ['a', 'b'], allow: ['code', 'claude'] }) });
while (Date.now() - started < minutes * 60_000) {
  await sleep(60_000);
  const st = JSON.parse(readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  const status = await call('/status');
  const helpers = helperPids();
  rows.push({
    minute: Math.round((Date.now() - started) / 60_000),
    serviceMB: memMB(svc.pid), helpers: helpers.length, helperMB: helpers.length ? memMB(helpers[0]) : null,
    logEntries: st.log.length, stateKB: Math.round(statSync(path.join(dataDir, 'state.json')).size / 1024),
    tickErrors: st.log.filter((e) => e.type === 'tick-error').length, watcherRestarts: st.log.filter((e) => e.type === 'watcher-restart').length,
    label: status.label,
  });
  console.log(JSON.stringify(rows.at(-1)));
}
svc.kill();
const first = rows[0], last = rows.at(-1);
const summary = { minutes, sampleSeconds, rows, memoryGrowthMB: last && first ? last.serviceMB - first.serviceMB : null, tickErrors: last?.tickErrors, watcherRestarts: last?.watcherRestarts, maxHelpers: Math.max(...rows.map((r) => r.helpers)), stderr: stderr.slice(-500) };
writeFileSync(path.join(dataDir, 'soak-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
