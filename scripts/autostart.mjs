#!/usr/bin/env node
// Starts the pet (and with it the service and the local decision model) when
// you log in to Windows, via a shortcut in your Startup folder, and puts a
// "Body Double" icon on the Desktop to start it by hand. Run it yourself:
//   node scripts/autostart.mjs   |   node scripts/autostart.mjs --remove
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lnk = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Focus companion.lnk');
// The Desktop may be redirected (OneDrive), so ask Windows where it is.
const desktop = () => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim();

if (process.argv.includes('--remove')) {
  for (const f of [lnk, path.join(desktop(), 'Body Double.lnk')]) if (existsSync(f)) { rmSync(f); console.log(`Removed ${f}`); }
} else {
  const electron = createRequire(import.meta.url)('electron');
  // Paths travel through environment variables, never spliced into the script.
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:BD_LNK)',
    '$s.TargetPath = $env:BD_TARGET',
    '$s.Arguments = [char]34 + $env:BD_MAIN + [char]34',
    '$s.WorkingDirectory = $env:BD_ROOT',
    "$s.Description = 'Focus companion pet'",
    '$s.Save()',
  ].join('; ');
  for (const at of [lnk, path.join(desktop(), 'Body Double.lnk')]) execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, BD_LNK: at, BD_TARGET: electron, BD_MAIN: path.join(root, 'src', 'pet', 'main.js'), BD_ROOT: root },
    stdio: 'inherit',
  });
  console.log(`Created ${lnk} (starts at login) and a "Body Double" icon on the Desktop.`);
}
