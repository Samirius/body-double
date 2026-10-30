// Windows notification without extra dependencies: a short-lived PowerShell
// process shows a tray balloon (rendered as a toast on Windows 10/11).
// Text is passed through environment variables, never interpolated into the
// script, so quotes or $ in a message cannot break or inject into it.
import { spawn } from 'node:child_process';

const SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipTitle = $env:BD_TITLE
$n.BalloonTipText = $env:BD_TEXT
$n.Visible = $true
$n.ShowBalloonTip(8000)
Start-Sleep -Seconds 9
$n.Dispose()
`;

export function notify(title, text) {
  if (process.platform !== 'win32') return;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT], {
    windowsHide: true, detached: true, stdio: 'ignore',
    env: { ...process.env, BD_TITLE: String(title).slice(0, 63), BD_TEXT: String(text).slice(0, 255) },
  });
  child.unref();
}
