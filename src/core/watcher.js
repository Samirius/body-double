// Foreground-window watcher for Windows. One long-lived PowerShell process
// answers "which window is in front?" on request, so there is no native addon
// to compile and no new process per sample. Only the window title, process
// name and user idle time leave this module; nothing is stored here.
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

export function createWatcher({ spawnFn = spawn } = {}) {
  // -Command - would wait for stdin to close before running, so the script
  // goes into a temp .ps1 and stdin is left free for sample requests.
  const scriptPath = path.join(mkdtempSync(path.join(tmpdir(), 'bd-watch-')), 'watch.ps1');
  writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
  const ps = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: ps.stdout });
  const waiting = [];
  lines.on('line', (line) => {
    const resolve = waiting.shift();
    if (!resolve) return;
    try { resolve(JSON.parse(line)); } catch { resolve(null); }
  });
  return {
    sample() {
      return new Promise((resolve) => {
        waiting.push(resolve);
        ps.stdin.write('next\n');
      }).then((s) => (s ? { title: s.title || '', app: (s.app || '').toLowerCase(), idleSeconds: Math.max(0, Math.round((s.idleMs || 0) / 1000)), at: Date.now() } : null));
    },
    stop() { try { ps.stdin.write('quit\n'); ps.stdin.end(); } catch { /* already gone */ } },
  };
}
