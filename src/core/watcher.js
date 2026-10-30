// Foreground-window watcher for Windows. One long-lived PowerShell process
// answers "which window is in front?" on request, so there is no native addon
// to compile and no new process per sample. Only the window title, process
// name and user idle time leave this module; nothing is stored here.
//
// Self-healing: if the helper exits, errors, or does not answer within
// `sampleTimeoutMs`, the pending sample resolves to null and the next sample
// starts a fresh helper. A dead helper therefore costs one missed sample,
// never silently stops the companion.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
}
"@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'quit') { break }
  $h = [Fg]::GetForegroundWindow()
  $sb = New-Object Text.StringBuilder 512
  [void][Fg]::GetWindowText($h, $sb, 512)
  $procId = 0; [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''; try { $name = (Get-Process -Id $procId).ProcessName } catch {}
  $lii = New-Object Fg+LII; $lii.cbSize = 8; [void][Fg]::GetLastInputInfo([ref]$lii)
  $idleMs = [Environment]::TickCount - [int]$lii.dwTime
  @{ title = $sb.ToString(); app = $name; idleMs = $idleMs } | ConvertTo-Json -Compress
}
`;

function defaultSpawnHelper() {
  // -Command - would wait for stdin to close before running, so the script
  // goes into a temp .ps1 and stdin is left free for sample requests.
  const scriptPath = path.join(mkdtempSync(path.join(tmpdir(), 'bd-watch-')), 'watch.ps1');
  writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
}

export function normalizeSample(s, at = Date.now()) {
  if (!s || typeof s !== 'object') return null;
  return { title: String(s.title || ''), app: String(s.app || '').toLowerCase(), idleSeconds: Math.max(0, Math.round((Number(s.idleMs) || 0) / 1000)), at };
}

export function createWatcher({ spawnHelper = defaultSpawnHelper, sampleTimeoutMs = 5000, onRestart = () => {} } = {}) {
  let child = null;
  let waiting = []; // FIFO of { resolve, timer }
  let restarts = 0;
  let stopped = false;

  const failAll = () => { for (const w of waiting) { clearTimeout(w.timer); w.resolve(null); } waiting = []; };

  function kill() {
    if (!child) return;
    const c = child; child = null;
    try { c.stdin.end(); } catch { /* gone */ }
    try { c.kill(); } catch { /* gone */ }
  }

  function ensureChild() {
    if (child || stopped) return child;
    const c = spawnHelper();
    child = c;
    const lines = createInterface({ input: c.stdout });
    lines.on('line', (line) => {
      if (c !== child) return; // a replaced helper's late output is ignored
      const w = waiting.shift();
      if (!w) return;
      clearTimeout(w.timer);
      let parsed = null;
      try { parsed = JSON.parse(line); } catch { /* malformed line -> null sample */ }
      w.resolve(normalizeSample(parsed));
    });
    const onDeath = () => { if (c === child) { child = null; failAll(); } };
    c.on('exit', onDeath);
    c.on('error', onDeath);
    c.stdin.on('error', onDeath);
    return c;
  }

  return {
    sample() {
      if (stopped) return Promise.resolve(null);
      const fresh = !child;
      const c = ensureChild();
      if (!c) return Promise.resolve(null);
      if (fresh && restarts++ > 0) onRestart(restarts - 1);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          // Hung helper: drop it; the next sample spawns a new one.
          waiting = waiting.filter((w) => w.timer !== timer);
          resolve(null);
          kill();
          failAll();
        }, sampleTimeoutMs);
        waiting.push({ resolve, timer });
        try { c.stdin.write('next\n'); } catch { kill(); failAll(); }
      });
    },
    stats: () => ({ restarts: Math.max(0, restarts - 1), alive: !!child }),
    stop() { stopped = true; try { child?.stdin.write('quit\n'); } catch { /* gone */ } kill(); failAll(); },
  };
}
