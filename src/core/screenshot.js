// One downscaled screenshot of the primary screen as base64 PNG, for the
// judge in 'screenshot' mode only. The temp file is deleted immediately and
// the image is never stored by the companion.
import { execFile } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$full = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($full); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$scale = [Math]::Min(1.0, [double]$env:BD_SHOT_MAXW / $b.Width)
$w = [int]($b.Width * $scale); $h = [int]($b.Height * $scale)
$small = New-Object System.Drawing.Bitmap $w, $h
$g2 = [System.Drawing.Graphics]::FromImage($small); $g2.InterpolationMode = 'HighQualityBicubic'; $g2.DrawImage($full, 0, 0, $w, $h)
$small.Save($env:BD_SHOT_FILE, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $g2.Dispose(); $full.Dispose(); $small.Dispose()
`;

export function captureScreen({ maxWidth = 1280, timeoutMs = 8000 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bd-shot-'));
  const file = path.join(dir, 'shot.png');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true, timeout: timeoutMs, env: { ...process.env, BD_SHOT_FILE: file, BD_SHOT_MAXW: String(maxWidth) } }, (err) => {
      let data = null;
      try { if (!err) data = readFileSync(file).toString('base64'); } catch { /* no image */ }
      rmSync(dir, { recursive: true, force: true });
      resolve(data);
    });
  });
}
